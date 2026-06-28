---
name: harness-creator
description: Create a minimal restartable Codex project harness without overwriting existing files.
---

# Harness Creator

Use this skill when a repository needs explicit project context, resumable work state,
and a repeatable startup check.

## Workflow

1. Inspect the target directory and identify existing files.
2. Run:

   ```bash
   node "${CODEX_PLUGIN_ROOT}/runtime/harness-core/cli.mjs" create "$PWD"
   ```

3. Read the JSON result. `created` lists new files and `preserved` proves which user
   files were left untouched.
4. Replace placeholder purpose, boundaries, acceptance criteria, and bootstrap
   verification only when repository evidence supports the changes.
5. Run `./init.sh`, then run the doctor command and report both results.

Never overwrite existing project files or invent product requirements.
