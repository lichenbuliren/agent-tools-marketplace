# Agent Tools Marketplace

## Mission

This repository is the single canonical source for reusable Codex plugins,
standalone skills, shared runtime packages, and supporting development tools
owned by this project.

The first product is `harness-engineering`, which creates, diagnoses, and
archives restartable coding-agent harnesses through three namespaced skills.

## Product Boundaries

- `.agents/plugins/marketplace.json` is the repository marketplace registry.
- `plugins/<name>/` is an installable plugin payload boundary.
- Root `AGENTS.md`, `feature_list.json`, `progress.md`, `.harness/`, and
  `init.sh` operate this source repository; they are not plugin payload.
- A plugin must be self-contained after installation and must not import from
  repository-root harness files, sibling source products, local caches, or
  machine-specific paths.
- Consumer-project harness files are created only when a user explicitly runs
  `harness-creator`; they are distinct from this repository's own harness.

## Planned Source Model

- `plugins/` owns installable Codex plugins.
- `skills/` is reserved for future standalone skill source.
- `packages/` is reserved for shared source that must be packaged into
  self-contained distribution artifacts.
- `tools/` is reserved for repository development and release tooling.
- `docs/` records architecture, contribution, and release guidance as the
  marketplace grows.

Directories should be introduced only when the first real artifact needs them.

## Evidence Status

- `harness-engineering@0.2.0` is published from this repository's `master`.
- Isolated marketplace installation, plugin listing, and fresh-process skill
  discovery are verified by `npm test`.
- These checks establish Distribution and bounded structural Readiness. They do
  not establish general task Effectiveness.

## Restart Assumptions

A new session starts from `AGENTS.md`, this file, `feature_list.json`, and
`progress.md`, then runs `./init.sh`. Current work must name its branch,
verification command, evidence, and next action before the session ends.
