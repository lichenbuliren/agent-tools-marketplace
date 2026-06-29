import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const marketplacePath = resolve(
  repositoryRoot,
  ".agents/plugins/marketplace.json",
);
const pluginRoot = resolve(
  repositoryRoot,
  "plugins/harness-engineering",
);
const runtimePath = resolve(
  pluginRoot,
  "runtime/harness-core/cli.mjs",
);
const requiredSkills = [
  "harness-creator",
  "harness-doctor",
  "harness-archiver",
];

const runRuntime = (command, target) =>
  spawnSync(process.execPath, [runtimePath, command, target], {
    encoding: "utf8",
  });

test("marketplace exposes harness-engineering@agent-tools-marketplace", async () => {
  const marketplace = JSON.parse(await readFile(marketplacePath, "utf8"));
  assert.equal(marketplace.name, "agent-tools-marketplace");

  const plugin = marketplace.plugins.find(
    ({ name }) => name === "harness-engineering",
  );
  assert.ok(plugin, "marketplace must expose harness-engineering");
  assert.deepEqual(plugin.source, {
    source: "local",
    path: "./plugins/harness-engineering",
  });

  const manifest = JSON.parse(
    await readFile(
      resolve(pluginRoot, ".codex-plugin/plugin.json"),
      "utf8",
    ),
  );
  assert.equal(manifest.name, "harness-engineering");
  assert.equal(manifest.skills, "./skills/");

  for (const skill of requiredSkills) {
    const content = await readFile(
      resolve(pluginRoot, "skills", skill, "SKILL.md"),
      "utf8",
    );
    assert.match(content, new RegExp(`^---\\nname: ${skill}\\n`, "u"));
    assert.match(content, /CODEX_PLUGIN_ROOT/u);
  }
});

test("plugin offers concise Chinese-first harness starter prompts", async () => {
  const manifest = JSON.parse(
    await readFile(
      resolve(pluginRoot, ".codex-plugin/plugin.json"),
      "utf8",
    ),
  );
  const prompts = manifest.interface.defaultPrompt;

  assert.ok(Array.isArray(prompts));
  assert.ok(prompts.length >= 1 && prompts.length <= 3);
  for (const prompt of prompts) {
    assert.equal(typeof prompt, "string");
    assert.ok(prompt.trim().length > 0);
    assert.ok(prompt.length <= 128);
  }
  assert.ok(
    prompts.some(
      (prompt) =>
        /^\p{Script=Han}/u.test(prompt) &&
        /创建|诊断|归档/u.test(prompt),
    ),
    "at least one prompt must start in Chinese and offer a useful harness action",
  );
});

test("plugin runtime contains no checkout-specific dependency", async () => {
  const files = [
    runtimePath,
    ...requiredSkills.map((skill) =>
      resolve(pluginRoot, "skills", skill, "SKILL.md"),
    ),
  ];
  for (const path of files) {
    const content = await readFile(path, "utf8");
    assert.doesNotMatch(content, /harness-vibe-coding-study/u);
    assert.doesNotMatch(content, /\/Users\/heaven\//u);
    assert.doesNotMatch(content, /plugins\/cache/u);
  }
});

test("creator is conservative and doctor validates the result", async () => {
  const target = await mkdtemp(resolve(tmpdir(), "harness-core-create-"));
  await writeFile(resolve(target, "CONTEXT.md"), "user-owned\n");

  const creation = runRuntime("create", target);
  assert.equal(creation.status, 0, creation.stderr);
  const result = JSON.parse(creation.stdout);
  assert.ok(result.preserved.includes("CONTEXT.md"));
  assert.equal(await readFile(resolve(target, "CONTEXT.md"), "utf8"), "user-owned\n");

  const initMode = (await stat(resolve(target, "init.sh"))).mode;
  assert.ok(initMode & 0o100, "init.sh must be executable by its owner");

  const diagnosis = runRuntime("doctor", target);
  assert.equal(diagnosis.status, 0, diagnosis.stderr);
  assert.equal(JSON.parse(diagnosis.stdout).ok, true);

  const init = spawnSync(resolve(target, "init.sh"), {
    cwd: target,
    encoding: "utf8",
  });
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stdout, /bootstrap check passed/u);
});

test("archiver preserves prior progress and leaves a healthy harness", async () => {
  const target = await mkdtemp(resolve(tmpdir(), "harness-core-archive-"));
  assert.equal(runRuntime("create", target).status, 0);
  await writeFile(resolve(target, "progress.md"), "# Progress\n\nverified evidence\n");

  const archive = runRuntime("archive", target);
  assert.equal(archive.status, 0, archive.stderr);
  const archivedPath = JSON.parse(archive.stdout).archived;
  assert.equal(
    await readFile(archivedPath, "utf8"),
    "# Progress\n\nverified evidence\n",
  );
  assert.equal(runRuntime("doctor", target).status, 0);
});
