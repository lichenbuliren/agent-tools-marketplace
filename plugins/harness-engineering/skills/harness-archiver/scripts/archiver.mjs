#!/usr/bin/env node

import { applyPlan } from './apply.mjs';
import { createPlan } from './planner.mjs';
import { renderApplyText, renderPlanText } from './renderers.mjs';

const USAGE = `Usage:
  archiver plan --target <directory> --evolution <relative-path> [--format text|json] [--pretty]
  archiver apply --target <directory> --evolution <relative-path> --plan-id <sha256> [--format text|json] [--pretty]
  archiver --help
`;

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_ARGUMENTS';
  return error;
}

function parse(args) {
  if (args.length === 1 && args[0] === '--help') return {help: true};
  const command = args[0];
  if (!['plan', 'apply'].includes(command)) throw invalid('Missing or invalid command.');
  const options = {
    command,
    target: null,
    evolutionPath: null,
    planId: null,
    format: 'text',
    pretty: false
  };
  const seen = new Set();
  for (let index = 1; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--pretty') {
      if (seen.has(option)) throw invalid(`Duplicate argument: ${option}.`);
      seen.add(option);
      options.pretty = true;
      continue;
    }
    if (!['--target', '--evolution', '--plan-id', '--format'].includes(option)) {
      throw invalid(`Unknown argument: ${option}.`);
    }
    if (seen.has(option)) throw invalid(`Duplicate argument: ${option}.`);
    seen.add(option);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw invalid(`Missing value for ${option}.`);
    index += 1;
    if (option === '--target') options.target = value;
    if (option === '--evolution') options.evolutionPath = value;
    if (option === '--plan-id') options.planId = value;
    if (option === '--format') options.format = value;
  }
  if (!options.target) throw invalid('Missing required argument: --target.');
  if (!options.evolutionPath) throw invalid('Missing required argument: --evolution.');
  if (!['text', 'json'].includes(options.format)) throw invalid('Invalid format.');
  if (options.pretty && options.format !== 'json') {
    throw invalid('--pretty requires JSON format.');
  }
  if (command === 'apply' && !options.planId) {
    throw invalid('Missing required argument: --plan-id.');
  }
  if (command === 'plan' && options.planId) {
    throw invalid('--plan-id is valid only for apply.');
  }
  return options;
}

async function main() {
  let options;
  try {
    options = parse(process.argv.slice(2));
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
    const value = options.command === 'plan'
      ? await createPlan({
        root: options.target,
        evolutionPath: options.evolutionPath
      })
      : await applyPlan({
        root: options.target,
        evolutionPath: options.evolutionPath,
        planId: options.planId
      });
    if (options.command === 'plan' && !value.eligible) {
      throw invalid(renderPlanText(value));
    }
    const output = options.format === 'json'
      ? JSON.stringify(value, null, options.pretty ? 2 : undefined)
      : options.command === 'plan'
        ? renderPlanText(value)
        : renderApplyText(value);
    process.stdout.write(`${output}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
  }
}

await main();
