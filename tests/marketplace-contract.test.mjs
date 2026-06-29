import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = path.join(root, "plugins/harness-engineering");
const requiredSkills = [
  "harness-creator",
  "harness-doctor",
  "harness-archiver",
];

const readJson = async (relativePath) =>
  JSON.parse(await readFile(path.join(root, relativePath), "utf8"));

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    }),
  );
  return nested.flat();
}

async function requestFreshSkillList({ codexHome, cwd }) {
  const child = spawn("codex", ["app-server", "--stdio"], {
    cwd,
    env: { ...process.env, CODEX_HOME: codexHome },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  const response = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for skills/list.\n${stderr}`));
      child.kill();
    }, 15_000);

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code && code !== 143) {
        reject(new Error(`app-server exited with ${code}.\n${stderr}`));
      }
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.id === 1) {
          child.stdin.write(
            `${JSON.stringify({
              method: "skills/list",
              id: 2,
              params: { cwds: [cwd], forceReload: true },
            })}\n`,
          );
        }
        if (message.id === 2) {
          clearTimeout(timeout);
          resolve(message.result);
        }
      }
    });
  });

  child.stdin.write(
    `${JSON.stringify({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: {
          name: "marketplace-contract",
          title: "Marketplace Contract",
          version: "0.1.0",
        },
      },
    })}\n`,
  );

  try {
    return await response;
  } finally {
    child.stdin.end();
    child.kill();
  }
}

test("marketplace exposes the public harness-engineering selector", async () => {
  const marketplace = await readJson(".agents/plugins/marketplace.json");

  assert.equal(marketplace.name, "agent-tools-marketplace");
  assert.deepEqual(marketplace.plugins, [
    {
      name: "harness-engineering",
      source: {
        source: "local",
        path: "./plugins/harness-engineering",
      },
      policy: {
        installation: "AVAILABLE",
        authentication: "ON_INSTALL",
      },
      category: "Developer Tools",
    },
  ]);

  const plugin = await readJson(
    "plugins/harness-engineering/.codex-plugin/plugin.json",
  );
  assert.equal(plugin.name, "harness-engineering");
  assert.equal(plugin.version, "0.2.0");
  assert.equal(plugin.skills, "./skills/");
  assert.deepEqual(plugin.interface.defaultPrompt, [
    "为这个项目创建一个可恢复、可验证的 harness。",
    "诊断当前 harness 的缺口，并给出可执行的修复。",
    "归档已完成的 harness 阶段并保留连续性证据。",
  ]);
});

test("onboarding is Chinese-first and documents the install selector", async () => {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const license = await readFile(path.join(root, "LICENSE"), "utf8");

  assert.match(readme, /[\u3400-\u9fff]/u);
  assert.match(
    readme,
    /codex plugin marketplace add lichenbuliren\/agent-tools-marketplace --ref master/,
  );
  assert.match(
    readme,
    /codex plugin add harness-engineering@agent-tools-marketplace/,
  );
  assert.match(readme, /harness-engineering:harness-creator/);
  assert.match(readme, /harness-engineering:harness-doctor/);
  assert.match(readme, /harness-engineering:harness-archiver/);
  assert.doesNotMatch(readme, /\.\/init\.sh/);
  assert.doesNotMatch(readme, /根部的 `AGENTS\.md`/);
  assert.match(license, /^MIT License$/m);
});

test("plugin owns all required skills and runtime assets", async () => {
  await stat(
    path.join(pluginRoot, "runtime/harness-core/package.json"),
  );

  for (const skill of requiredSkills) {
    const skillSource = await readFile(
      path.join(pluginRoot, `skills/${skill}/SKILL.md`),
      "utf8",
    );
    assert.match(skillSource, new RegExp(`^name:\\s*${skill}$`, "m"));
  }
});

test("plugin is self-contained and every relative module import resolves", async () => {
  const files = await listFiles(pluginRoot);
  const forbidden = [
    "/Users/heaven/",
    "harness-vibe-coding-study",
    "plugins/cache",
  ];
  const importPattern =
    /(?:from\s+|import\s*\()\s*["'](\.[^"']+)["']/g;

  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const value of forbidden) {
      assert.equal(
        source.includes(value),
        false,
        `${path.relative(root, file)} contains forbidden reference ${value}`,
      );
    }
    if (!file.endsWith(".mjs")) continue;
    for (const match of source.matchAll(importPattern)) {
      const dependency = path.resolve(path.dirname(file), match[1]);
      await stat(dependency);
      assert.equal(
        dependency.startsWith(`${pluginRoot}${path.sep}`),
        true,
        `${path.relative(root, file)} imports outside the plugin`,
      );
    }
  }
});

test("all three packaged skill CLIs load from plugin-local runtime", async () => {
  const commands = {
    "harness-creator": "skills/harness-creator/scripts/creator.mjs",
    "harness-doctor": "skills/harness-doctor/scripts/doctor.mjs",
    "harness-archiver": "skills/harness-archiver/scripts/archiver.mjs",
  };

  await Promise.all(
    Object.entries(commands).map(async ([skill, relativePath]) => {
      const { stdout } = await exec(
        process.execPath,
        [path.join(pluginRoot, relativePath), "--help"],
        { cwd: pluginRoot },
      );
      assert.match(stdout, /Usage:/, `${skill} did not print usage`);
    }),
  );
});

test("isolated local install is discovered by a fresh Codex process", async () => {
  const sandbox = await mkdtemp(
    path.join(os.tmpdir(), "agent-tools-marketplace-"),
  );
  const isolatedMarketplace = path.join(sandbox, "marketplace");
  const codexHome = path.join(sandbox, "codex-home");

  try {
    await mkdir(codexHome);
    await cp(root, isolatedMarketplace, {
      recursive: true,
      filter: (source) => path.basename(source) !== ".git",
    });
    const env = { ...process.env, CODEX_HOME: codexHome };

    const { stdout: marketplaceOutput } = await exec(
      "codex",
      ["plugin", "marketplace", "add", isolatedMarketplace, "--json"],
      { env },
    );
    assert.equal(
      JSON.parse(marketplaceOutput).marketplaceName,
      "agent-tools-marketplace",
    );

    const { stdout: installOutput } = await exec(
      "codex",
      [
        "plugin",
        "add",
        "harness-engineering@agent-tools-marketplace",
        "--json",
      ],
      { env },
    );
    assert.equal(
      JSON.parse(installOutput).pluginId,
      "harness-engineering@agent-tools-marketplace",
    );

    const skillList = await requestFreshSkillList({
      codexHome,
      cwd: isolatedMarketplace,
    });
    const discoveredNames = skillList.data.flatMap(({ skills }) =>
      skills.map(({ name }) => name),
    );
    for (const skill of requiredSkills) {
      const qualifiedName = `harness-engineering:${skill}`;
      assert.ok(
        discoveredNames.includes(qualifiedName),
        `${qualifiedName} was not discovered: ${discoveredNames.join(", ")}`,
      );
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
