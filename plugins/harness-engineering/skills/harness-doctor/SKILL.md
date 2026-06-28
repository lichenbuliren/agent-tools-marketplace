---
name: harness-doctor
description: Diagnose whether a Codex project harness is complete, valid, and restartable.
---

# Harness Doctor

Use this skill to inspect an existing harness or verify one after creation.

## Workflow

1. Run:

   ```bash
   node "${CODEX_PLUGIN_ROOT}/runtime/harness-core/cli.mjs" doctor "$PWD"
   ```

2. Read every reported check. Fix only problems that are safe, local, and supported
   by repository evidence.
3. Run `./init.sh` when present.
4. Report the failing files or the successful checks and distinguish the generic
   bootstrap check from project-specific verification.

Do not claim product readiness solely because the harness structure is healthy.
