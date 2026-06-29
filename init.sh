#!/bin/bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repository_root"

check_path() {
  if [[ ! -e "$1" ]]; then
    echo "MISSING: $1" >&2
    return 1
  fi
  echo "OK: $1"
}

check_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "MISSING TOOL: $1" >&2
    return 1
  fi
  echo "OK TOOL: $1"
}

echo "=== Harness path check ==="
check_path ".harness/manifest.json"
check_path "AGENTS.md"
check_path "CONTEXT.md"
check_path "feature_list.json"
check_path "progress.md"
check_path ".agents/plugins/marketplace.json"
check_path "plugins/harness-engineering/.codex-plugin/plugin.json"
check_path "plugins/harness-engineering/skills/harness-creator/SKILL.md"
check_path "plugins/harness-engineering/skills/harness-doctor/SKILL.md"
check_path "plugins/harness-engineering/skills/harness-archiver/SKILL.md"

echo "=== Required tool check ==="
check_tool "git"
check_tool "node"
check_tool "npm"

echo "=== JSON state check ==="
node -e 'for (const path of [".harness/manifest.json", "feature_list.json", ".agents/plugins/marketplace.json", "plugins/harness-engineering/.codex-plugin/plugin.json"]) JSON.parse(require("node:fs").readFileSync(path, "utf8"))'

echo "=== Project verification ==="
npm test

echo "=== Harness check complete ==="
echo "Next: read feature_list.json and progress.md."
