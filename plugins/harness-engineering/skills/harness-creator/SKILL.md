---
name: harness-creator
description: Use when a coding-agent repository needs a new harness or a safe improvement to its instructions, tools, environment, state, feedback, or restart workflow.
---

# Harness Creator

Create or improve a minimal harness without overwriting project-owned work.

## Plan Before Writing

Run from this skill directory:

```bash
node scripts/creator.mjs plan --target <repository>
```

Use `--format json --pretty` when a machine-readable plan is helpful. Add
`--agent-file CLAUDE.md` only for a Claude-oriented repository. Use
`progress.md` as the single cross-session continuity surface.

Present the complete action list, intended content, blocked actions, and
`planId`. Explain that existing files are skipped and that the plan becomes
stale if relevant target state changes.

## Apply The Presented Plan

Apply only the exact plan that was presented:

```bash
node scripts/creator.mjs apply \
  --target <repository> \
  --plan-id <planId>
```

Repeat every option used during planning. Never invent a `planId`, add
overwrite behavior, or bypass a blocked plan.

Respect one branch/one writer thread. A foreign branch lease blocks every
Creator mutation. Apply may claim a missing lease temporarily and must release
only that temporary lease; preserve a lease already owned by this thread.

Report each `created`, `merged`, `skipped`, or `blocked` result. Then run
`harness-doctor` against the target and explain the before/after Readiness
profile without claiming Effectiveness.

## Preserve Project Facts

Creator must not invent mission, scope, architecture, domain language, current
work, or verification evidence.

When context is missing, Creator adds the real `Project Context Restoration`
feature. Complete that task with the user or project evidence: fill
`CONTEXT.md` or a declared equivalent with project-owned facts. Do not replace
the task with placeholders merely to make structural checks pass.

Keep setup separate. Do not install dependencies, access the network, start
services, delete files, or execute target-project commands as part of creation.
