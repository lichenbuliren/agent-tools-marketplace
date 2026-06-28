#!/usr/bin/env node

import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import process from "node:process";

const REQUIRED_FILES = [
  "AGENTS.md",
  "CONTEXT.md",
  "feature_list.json",
  "progress.md",
  "init.sh",
  "session-handoff.md",
];

const projectName = (root) => basename(root);

function templates(root) {
  const name = projectName(root);
  return {
    "AGENTS.md": `# Agent Operating Contract

Read \`CONTEXT.md\`, \`feature_list.json\`, and \`progress.md\` before changing the project.
Work on one \`next\` or \`in-progress\` feature at a time. Preserve user files, keep changes
small, run \`./init.sh\`, and record verification evidence before claiming completion.
`,
    "CONTEXT.md": `# ${name}

## Purpose

Describe the durable product purpose here.

## Boundaries

- Record stable constraints, not temporary implementation state.
- Keep current work and evidence in \`feature_list.json\` and \`progress.md\`.
`,
    "feature_list.json": `${JSON.stringify(
      {
        schemaVersion: 1,
        features: [
          {
            id: "feat-001",
            title: "Restore project context",
            status: "next",
            acceptance: [
              "Purpose and boundaries are concrete in CONTEXT.md",
              "Project-specific verification replaces the bootstrap check",
            ],
            evidence: [],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "progress.md": `# Progress

## Current state

Harness scaffold created. Project-specific context and verification are still pending.

## Verification

- \`./init.sh\`: bootstrap structure check

## Next step

Complete \`feat-001\` without inventing product requirements.
`,
    "init.sh": `#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

required=(AGENTS.md CONTEXT.md feature_list.json progress.md init.sh session-handoff.md)
for file in "\${required[@]}"; do
  [[ -f "$file" ]] || { echo "missing required harness file: $file" >&2; exit 1; }
done

node -e 'JSON.parse(require("node:fs").readFileSync("feature_list.json", "utf8"))'
echo "harness bootstrap check passed"
`,
    "session-handoff.md": `# Session Handoff

## Resume

1. Read \`AGENTS.md\`, \`CONTEXT.md\`, \`feature_list.json\`, and \`progress.md\`.
2. Run \`./init.sh\`.
3. Continue the single active feature and record fresh evidence.
`,
  };
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function createHarness(root) {
  await mkdir(root, { recursive: true });
  const created = [];
  const preserved = [];

  for (const [name, content] of Object.entries(templates(root))) {
    const path = join(root, name);
    if (await fileExists(path)) {
      preserved.push(name);
      continue;
    }
    await writeFile(path, content, { flag: "wx" });
    created.push(name);
  }

  if (created.includes("init.sh")) {
    await chmod(join(root, "init.sh"), 0o755);
  }

  return { command: "create", root, created, preserved };
}

async function diagnoseHarness(root) {
  const checks = [];
  for (const name of REQUIRED_FILES) {
    checks.push({
      name,
      ok: await fileExists(join(root, name)),
    });
  }

  const featureCheck = checks.find(({ name }) => name === "feature_list.json");
  if (featureCheck.ok) {
    try {
      const parsed = JSON.parse(
        await readFile(join(root, "feature_list.json"), "utf8"),
      );
      featureCheck.ok =
        parsed.schemaVersion === 1 && Array.isArray(parsed.features);
      featureCheck.detail = featureCheck.ok
        ? `${parsed.features.length} feature(s)`
        : "expected schemaVersion 1 and a features array";
    } catch (error) {
      featureCheck.ok = false;
      featureCheck.detail = `invalid JSON: ${error.message}`;
    }
  }

  return {
    command: "doctor",
    root,
    ok: checks.every(({ ok }) => ok),
    checks,
  };
}

async function archiveHarness(root) {
  const diagnosis = await diagnoseHarness(root);
  if (!diagnosis.ok) {
    throw new Error("harness is not healthy; run doctor before archive");
  }

  const source = join(root, "progress.md");
  const content = await readFile(source, "utf8");
  const archiveRoot = join(root, ".harness-archive");
  await mkdir(archiveRoot, { recursive: true });

  const stamp = new Date().toISOString().replaceAll(":", "-");
  const destination = join(archiveRoot, `progress-${stamp}.md`);
  await writeFile(destination, content, { flag: "wx" });

  const nextProgress = `# Progress

## Current state

Previous session evidence archived to \`.harness-archive/${basename(destination)}\`.

## Verification

- Run \`./init.sh\` and add fresh project-specific evidence.

## Next step

Resume the next incomplete feature in \`feature_list.json\`.
`;
  const temporary = `${source}.tmp-${process.pid}`;
  await writeFile(temporary, nextProgress, { flag: "wx" });
  await rename(temporary, source);

  return {
    command: "archive",
    root,
    archived: destination,
  };
}

function usage() {
  return `Usage: node cli.mjs <create|doctor|archive> [target]

Commands:
  create   Add missing harness files without overwriting existing files
  doctor   Validate required files and feature_list.json
  archive  Preserve progress.md and start a fresh progress record
`;
}

async function main() {
  const [command, target = "."] = process.argv.slice(2);
  const root = resolve(target);
  let result;

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(usage());
    return;
  }

  if (command === "create") result = await createHarness(root);
  else if (command === "doctor") result = await diagnoseHarness(root);
  else if (command === "archive") result = await archiveHarness(root);
  else {
    process.stderr.write(usage());
    process.exitCode = 2;
    return;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (command === "doctor" && !result.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`harness-core: ${error.message}\n`);
  process.exitCode = 1;
});
