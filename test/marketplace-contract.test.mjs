import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("marketplace exposes a self-contained harness-engineering plugin", async () => {
  const marketplace = await readJson(".codex-plugin/marketplace.json");

  assert.equal(marketplace.name, "agent-tools-marketplace");
  assert.deepEqual(
    marketplace.plugins.map(({ name, source }) => ({ name, source })),
    [
      {
        name: "harness-engineering",
        source: "./plugins/harness-engineering",
      },
    ],
  );

  const plugin = await readJson(
    "plugins/harness-engineering/.codex-plugin/plugin.json",
  );
  assert.equal(plugin.name, "harness-engineering");

  for (const skill of [
    "harness-creator",
    "harness-doctor",
    "harness-archiver",
  ]) {
    const skillSource = await readFile(
      `plugins/harness-engineering/skills/${skill}/SKILL.md`,
      "utf8",
    );
    assert.match(skillSource, new RegExp(`^name:\\s*${skill}$`, "m"));
  }
});
