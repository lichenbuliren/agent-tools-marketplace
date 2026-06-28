#!/usr/bin/env node

import { inspectHarness } from '../src/index.mjs';

const USAGE = `Usage:
  inspect-harness --target <directory> [--manifest <relative-path>] [--pretty]
  inspect-harness --help
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
  const options = {
    target: null,
    manifestPath: undefined,
    pretty: false,
    help: false
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--help') {
      options.help = true;
      continue;
    }
    if (argument === '--pretty') {
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
    if (argument === '--manifest') {
      if (options.manifestPath !== undefined) {
        throw argumentError('Duplicate argument: --manifest.');
      }
      options.manifestPath = requireValue(arguments_, index, argument);
      index += 1;
      continue;
    }
    throw argumentError(`Unknown argument: ${argument}`);
  }

  if (!options.help && options.target === null) {
    throw argumentError('Missing required argument: --target.');
  }
  return options;
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
    const result = await inspectHarness({
      root: options.target,
      manifestPath: options.manifestPath
    });
    const spacing = options.pretty ? 2 : undefined;
    process.stdout.write(`${JSON.stringify(result, null, spacing)}\n`);
  } catch (error) {
    process.stderr.write(
      `Unable to inspect target: ${error.message}\n\n${USAGE}`
    );
    process.exitCode = 2;
  }
}

await main();
