#!/bin/bash
set -euo pipefail

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
check_path "package.json"
check_path "progress.md"

echo "=== Required tool check ==="
check_tool "node"

echo "=== Project verification commands ==="
echo "  - node --test test/marketplace-contract.test.mjs"

echo "=== Harness check complete ==="
echo "Next: read feature_list.json and progress.md, then run the listed verification commands."
