# Agent Operating Contract

This repository is the canonical source for reusable Codex plugins, standalone
skills, shared packages, and development tools.

## Startup

1. Confirm the working directory with `pwd`.
2. Read `AGENTS.md`, `README.md` when present, and `CONTEXT.md` when present.
3. Read `feature_list.json` and `progress.md`.
4. Run `./init.sh` to check harness paths and required tools.
5. Work from exactly one active feature.

## Working Rules

- Preserve project-owned facts and existing files.
- Keep repository-development harness files at the root. Keep installable
  plugin payloads under `plugins/<plugin-name>/`.
- Do not make an installed plugin depend on root files or machine-local paths.
- Treat `.agents/plugins/marketplace.json` as the distribution registry and
  each referenced plugin directory as an independent installation boundary.
- Keep one active feature unless the tracker explicitly uses parallel mode.
- Record the active feature's Git branch before changing its status to `in-progress`.
- Keep one writer thread per branch. Claim the local cooperative lease before
  mutation with `branch-lease claim --target . --feature-id <id>`.
- Stay inside the active feature's behavior and dependencies.
- Run documented verification before claiming completion.
- Record concrete evidence before setting a feature to `done`.
- Update `progress.md` when state, blockers, evidence, or next steps change.

## Verification Commands

- `./init.sh`
- `npm test`

## Definition Of Done

Work is done only when the requested behavior is complete, verification ran,
evidence is recorded, scope remains bounded, and the next session can restart
from this workflow.
