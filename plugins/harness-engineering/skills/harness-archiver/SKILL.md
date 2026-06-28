---
name: harness-archiver
description: Archive completed harness progress while preserving restartable current state.
---

# Harness Archiver

Use this skill only when the current stage is complete and its evidence has already
been recorded.

## Workflow

1. Confirm `feature_list.json` and `progress.md` describe the completed state.
2. Run:

   ```bash
   node "${CODEX_PLUGIN_ROOT}/runtime/harness-core/cli.mjs" archive "$PWD"
   ```

3. Confirm the JSON result points to a timestamped copy under `.harness-archive/`.
4. Run `./init.sh` and the doctor command.
5. Report the archived path and the next incomplete feature.

The runtime refuses to archive an unhealthy harness. Do not use archive as a substitute
for recording missing evidence.
