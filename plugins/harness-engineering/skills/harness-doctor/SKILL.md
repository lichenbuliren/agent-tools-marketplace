---
name: harness-doctor
description: Use when a coding-agent repository is hard to start, resume, verify, or diagnose, or when harness readiness and missing project capabilities need inspection.
---

# Harness Doctor

Diagnose harness readiness without modifying the target repository.

## Run The Inspection

Run from this skill directory:

```bash
node scripts/doctor.mjs --target <repository>
```

Use the default Text output for conversation. Select `--format json`,
`markdown`, or `html` only when the user requests machine-readable data or a
specific artifact format. Use `--pretty` only with JSON.

## Interpret The Result

Report the five-dimensional readiness profile in canonical order:
Instructions, Tools, Environment, State, and Feedback. Preserve `Unknown`
findings rather than guessing from absent or unreadable evidence.

Treat low dimensions as candidate bottlenecks, not proven causes. Present at
most three recommendations, keeping their supplied priority and rule IDs.
Preserve `Effectiveness: not-assessed`; repository structure demonstrates
readiness, not whether agents produce good outcomes.

## Keep The Boundary

Report lifecycle observations separately from Readiness: archive eligibility,
baseline integrity, feature branch alignment, and cooperative branch ownership.
Recommend `harness-archiver` only after an explicit user archive request.

Remain read-only. Do not create, rewrite, or delete target files. If the user
asks to repair findings, hand the assessment to `harness-creator`; do not
silently turn diagnosis into mutation. Never acquire a lease or archive work.
