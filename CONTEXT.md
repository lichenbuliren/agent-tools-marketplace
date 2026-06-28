# Project Context

## Mission

Build `agent-tools-marketplace`, a reusable public Codex agent-tools
marketplace. Users select the plugin as
`harness-engineering@agent-tools-marketplace`.

## Product Boundary

- Root marketplace metadata discovers one plugin at
  `plugins/harness-engineering/`.
- The plugin is self-contained: it owns its source, runtime assets, and the
  `harness-creator`, `harness-doctor`, and `harness-archiver` skills.
- Runtime behavior must not depend on `harness-vibe-coding-study`,
  `/Users/heaven/`, or machine-local plugin cache paths.
- Installation and fresh-process discovery must be provable from an isolated
  local copy.
- Root-level harness artifacts are development infrastructure for this
  experiment, not files the published plugin creates in consumer repositories
  unless a user explicitly invokes a harness workflow.

## Onboarding

User-facing onboarding is Chinese-first. Paths, commands, selectors, and Codex
terms remain in English where precision matters.

## Current Evidence

- The repository began from an empty neutral Git baseline on branch
  `experiment/harness`.
- `harness-engineering:harness-creator` generated the initial development
  harness.
- `./init.sh` is the startup check.
- `node --test test/marketplace-contract.test.mjs` is the product contract
  check introduced at the first interruption checkpoint.

## Restart Assumptions

A fresh session reads `AGENTS.md`, this file, `feature_list.json`, and
`progress.md`, runs `./init.sh`, and resumes the single active feature. Chat
history and machine-local plugin sources are not authoritative project state.
