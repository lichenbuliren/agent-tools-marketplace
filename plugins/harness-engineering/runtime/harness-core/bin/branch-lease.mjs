#!/usr/bin/env node

import {
  applyBranchLeaseTakeover,
  claimBranchLease,
  planBranchLeaseTakeover,
  readBranchLease,
  releaseBranchLease
} from '../src/index.mjs';

const COMMANDS = new Set([
  'claim',
  'check',
  'release',
  'takeover-plan',
  'takeover-apply'
]);
const USAGE = `Usage:
  branch-lease claim --target <directory> --feature-id <id> [--format text|json]
  branch-lease check --target <directory> [--format text|json]
  branch-lease release --target <directory> [--format text|json]
  branch-lease takeover-plan --target <directory> [--format text|json]
  branch-lease takeover-apply --target <directory> --feature-id <id> --plan-id <sha256> [--format text|json]
  branch-lease --help
`;

function argumentError(message) {
  const error = new Error(message);
  error.code = 'INVALID_ARGUMENTS';
  return error;
}

function requireValue(arguments_, index, option) {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw argumentError(`Missing value for ${option}.`);
  }
  return value;
}

function parseArguments(arguments_) {
  if (arguments_.length === 1 && arguments_[0] === '--help') {
    return {help: true};
  }
  const command = arguments_[0];
  if (!COMMANDS.has(command)) {
    throw argumentError(`Unknown or missing command: ${command ?? ''}.`);
  }
  const options = {
    command,
    target: null,
    featureId: null,
    planId: null,
    format: 'text'
  };
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!['--target', '--feature-id', '--plan-id', '--format'].includes(argument)) {
      throw argumentError(`Unknown argument: ${argument}.`);
    }
    const value = requireValue(arguments_, index, argument);
    index += 1;
    const key = {
      '--target': 'target',
      '--feature-id': 'featureId',
      '--plan-id': 'planId',
      '--format': 'format'
    }[argument];
    if (options[key] !== null && key !== 'format') {
      throw argumentError(`Duplicate argument: ${argument}.`);
    }
    options[key] = value;
  }
  if (options.target === null) {
    throw argumentError('Missing required argument: --target.');
  }
  if (!['text', 'json'].includes(options.format)) {
    throw argumentError('Invalid --format: use text or json.');
  }
  if (['claim', 'takeover-apply'].includes(command)
    && options.featureId === null) {
    throw argumentError('Missing required argument: --feature-id.');
  }
  if (command === 'takeover-apply' && options.planId === null) {
    throw argumentError('Missing required argument: --plan-id.');
  }
  return options;
}

function renderBlocked(result) {
  return `BLOCKED: branch-owned-by-another-thread
Branch: ${result.lease.branch}
Feature: ${result.lease.featureId}
Owner thread: ${result.lease.threadId}
Worktree: ${result.lease.worktree}
Acquired: ${result.lease.acquiredAt}
No files were modified.
Recovery: continue in the owner thread, use a separate branch/worktree, hand off and release, or explicitly plan a takeover.`;
}

function renderText(result) {
  if (result.status === 'blocked' || result.status === 'foreign') {
    return renderBlocked(result);
  }
  if (result.planId !== undefined) {
    return `Takeover plan: ${result.planId}
Branch: ${result.branch}
Previous owner: ${result.previousOwnerThread}
Next owner: ${result.nextOwnerThread}`;
  }
  return `Lease status: ${result.status}
Branch: ${result.lease?.branch ?? result.workspace.branch}
Owner thread: ${result.lease?.threadId ?? 'none'}`;
}

async function execute(options) {
  if (options.command === 'claim') {
    return claimBranchLease({
      root: options.target,
      featureId: options.featureId
    });
  }
  if (options.command === 'check') {
    return readBranchLease({root: options.target});
  }
  if (options.command === 'release') {
    const current = await readBranchLease({root: options.target});
    if (current.status !== 'owned') {
      return current;
    }
    return releaseBranchLease({
      root: options.target,
      leaseId: current.lease.leaseId
    });
  }
  if (options.command === 'takeover-plan') {
    return planBranchLeaseTakeover({root: options.target});
  }
  return applyBranchLeaseTakeover({
    root: options.target,
    featureId: options.featureId,
    planId: options.planId
  });
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  try {
    const result = await execute(options);
    process.stdout.write(`${options.format === 'json'
      ? JSON.stringify(result)
      : renderText(result)}\n`);
    if (result.status === 'blocked' || result.status === 'foreign') {
      process.exitCode = 2;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

await main();
