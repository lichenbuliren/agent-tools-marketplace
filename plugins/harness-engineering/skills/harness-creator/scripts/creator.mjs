#!/usr/bin/env node

import { applyPlan } from './apply.mjs';
import { createPlan } from './planner.mjs';
import {
  renderApplyText,
  renderPlanText
} from './renderers.mjs';

const FORMATS = new Set(['text', 'json']);
const USAGE = `Usage:
  creator plan --target <directory> [--agent-file AGENTS.md|CLAUDE.md] [--format text|json] [--pretty]
  creator apply --target <directory> --plan-id <sha256> [--agent-file AGENTS.md|CLAUDE.md] [--format text|json] [--pretty]
  creator --help
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
  if (!['plan', 'apply'].includes(command)) {
    throw argumentError(
      command === undefined
        ? 'Missing command: plan or apply.'
        : `Unknown command: ${command}.`
    );
  }
  const options = {
    command,
    target: null,
    agentFile: 'AGENTS.md',
    agentFileProvided: false,
    planId: null,
    format: 'text',
    formatProvided: false,
    pretty: false
  };

  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--pretty') {
      if (options.pretty) {
        throw argumentError('Duplicate argument: --pretty.');
      }
      options.pretty = true;
      continue;
    }
    if (argument === '--target') {
      if (options.target !== null) {
        throw argumentError('Duplicate argument: --target.');
      }
      options.target = requireValue(arguments_, index, argument);
      index += 1;
      continue;
    }
    if (argument === '--agent-file') {
      if (options.agentFileProvided) {
        throw argumentError('Duplicate argument: --agent-file.');
      }
      options.agentFile = requireValue(arguments_, index, argument);
      options.agentFileProvided = true;
      index += 1;
      continue;
    }
    if (argument === '--plan-id') {
      if (options.planId !== null) {
        throw argumentError('Duplicate argument: --plan-id.');
      }
      options.planId = requireValue(arguments_, index, argument);
      index += 1;
      continue;
    }
    if (argument === '--format') {
      if (options.formatProvided) {
        throw argumentError('Duplicate argument: --format.');
      }
      options.format = requireValue(arguments_, index, argument);
      options.formatProvided = true;
      index += 1;
      continue;
    }
    throw argumentError(`Unknown argument: ${argument}.`);
  }

  if (options.target === null) {
    throw argumentError('Missing required argument: --target.');
  }
  if (!['AGENTS.md', 'CLAUDE.md'].includes(options.agentFile)) {
    throw argumentError('Invalid --agent-file: use AGENTS.md or CLAUDE.md.');
  }
  if (!FORMATS.has(options.format)) {
    throw argumentError(`Invalid format: ${options.format}.`);
  }
  if (options.pretty && options.format !== 'json') {
    throw argumentError('--pretty is supported only for JSON output.');
  }
  if (command === 'apply' && options.planId === null) {
    throw argumentError('Missing required argument: --plan-id.');
  }
  if (command === 'plan' && options.planId !== null) {
    throw argumentError('--plan-id is valid only for apply.');
  }
  return options;
}

function serialize(value, options, textRenderer) {
  if (options.format === 'json') {
    return JSON.stringify(value, null, options.pretty ? 2 : undefined);
  }
  return textRenderer(value);
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
    const sharedOptions = {
      root: options.target,
      agentFile: options.agentFile,
      threadId: process.env.CODEX_THREAD_ID
    };
    const value = options.command === 'plan'
      ? await createPlan(sharedOptions)
      : await applyPlan({
        ...sharedOptions,
        planId: options.planId
      });
    const renderer = options.command === 'plan'
      ? renderPlanText
      : renderApplyText;
    process.stdout.write(`${serialize(value, options, renderer)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
  }
}

await main();
