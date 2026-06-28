---
name: harness-archiver
description: Use when a user explicitly asks to close a completed harness stage, compact feature_list.json and progress.md, or preserve completed work in an immutable evolution snapshot.
---

# Harness Archiver

Archive only completed, verified work and only after an explicit user request.
Planning is read-only; applying is bound to the exact presented `planId`.

## Workflow

1. Confirm the user actively requested archiving. Never archive automatically.
2. Run:

   ```bash
   node scripts/archiver.mjs plan \
     --target <directory> \
     --evolution <relative-path>
   ```

3. Present the stage ID, findings, actions, and `planId`. Stop when blocked.
4. After the plan is accepted, run:

   ```bash
   node scripts/archiver.mjs apply \
     --target <directory> \
     --evolution <relative-path> \
     --plan-id <sha256>
   ```

5. Report the snapshot path and new `.harness/baseline`.

## Safety Contract

- Require an attached, clean Git worktree.
- Require every current feature to be `done` with passing evidence.
- Require a repository-relative file under `docs/evolution/`.
- Respect the branch writer lease; never override another thread.
- Treat `docs/evolution/snapshots/<stageId>/` as immutable.
- Do not run project commands, commit, push, or invent evidence.
- If apply reports a stale plan or conflict, plan again and present the result.

Use `--format json` for machine-readable output and `--help` for the bounded
command surface.
