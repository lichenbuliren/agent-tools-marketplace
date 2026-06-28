const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const repositoryRoot = resolve(__dirname, "..");
const marketplacePath = resolve(
  repositoryRoot,
  ".agents/plugins/marketplace.json",
);
const requiredSkills = [
  "harness-creator",
  "harness-doctor",
  "harness-archiver",
];

test("marketplace exposes a self-contained harness-engineering plugin", () => {
  const marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));
  const pluginEntry = marketplace.plugins.find(
    ({ name }) => name === "harness-engineering",
  );

  assert.equal(marketplace.name, "agent-tools-marketplace");
  assert.ok(pluginEntry, "marketplace must publish harness-engineering");
  assert.deepEqual(pluginEntry.source, {
    source: "local",
    path: "./plugins/harness-engineering",
  });

  const pluginRoot = resolve(repositoryRoot, pluginEntry.source.path);
  const manifest = JSON.parse(
    readFileSync(
      resolve(pluginRoot, ".codex-plugin/plugin.json"),
      "utf8",
    ),
  );

  assert.equal(manifest.name, "harness-engineering");
  assert.equal(manifest.skills, "./skills/");

  const missingSkillFiles = requiredSkills
    .map((skillName) => resolve(pluginRoot, "skills", skillName, "SKILL.md"))
    .filter((skillPath) => !existsSync(skillPath))
    .map((skillPath) => skillPath.slice(repositoryRoot.length + 1));

  assert.deepEqual(
    missingSkillFiles,
    [],
    `plugin must own every required skill; missing: ${missingSkillFiles.join(", ")}`,
  );
});
