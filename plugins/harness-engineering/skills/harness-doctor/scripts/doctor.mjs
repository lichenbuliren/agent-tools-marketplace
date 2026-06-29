#!/usr/bin/env node

import {
  assessArchiveEligibility,
  discoverGitWorkspace,
  inspectHarness,
  readBranchLease,
  readBoundedFile,
  statSafePath,
  validateBaselineChain
} from '../../../runtime/harness-core/src/index.mjs';
import {
  renderHtml,
  renderMarkdown,
  renderText
} from './renderers.mjs';

const FORMATS = new Set(['text', 'json', 'markdown', 'html']);
const USAGE = `Usage:
  doctor --target <directory> [--manifest <relative-path>] [--format text|json|markdown|html] [--pretty]
  doctor --help
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
    format: 'text',
    formatProvided: false,
    pretty: false,
    help: false
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--help') {
      if (options.help) {
        throw argumentError('Duplicate argument: --help.');
      }
      options.help = true;
      continue;
    }
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
    if (argument === '--manifest') {
      if (options.manifestPath !== undefined) {
        throw argumentError('Duplicate argument: --manifest.');
      }
      options.manifestPath = requireValue(arguments_, index, argument);
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
    throw argumentError(`Unknown argument: ${argument}`);
  }

  if (!options.help && options.target === null) {
    throw argumentError('Missing required argument: --target.');
  }
  if (!FORMATS.has(options.format)) {
    throw argumentError(`Invalid format: ${options.format}.`);
  }
  if (options.pretty && options.format !== 'json') {
    throw argumentError('--pretty is supported only for JSON output.');
  }
  return options;
}

function render(assessment, options) {
  if (options.format === 'json') {
    return JSON.stringify(assessment, null, options.pretty ? 2 : undefined);
  }
  if (options.format === 'markdown') {
    return renderMarkdown(assessment);
  }
  if (options.format === 'html') {
    return renderHtml(assessment);
  }
  return renderText(assessment);
}

async function inspectLifecycle(root) {
  const gitMarker = await statSafePath(root, '.git');
  if (!gitMarker.ok && gitMarker.reason !== 'not-file') return null;

  const recommendations = [];
  const featureFile = await readBoundedFile(root, 'feature_list.json', {
    maxBytes: 262_144
  });
  let archiveEligible = false;
  let featureState = null;
  if (featureFile.ok) {
    try {
      featureState = JSON.parse(featureFile.content);
      archiveEligible = assessArchiveEligibility(featureState).eligible;
    } catch {
      archiveEligible = false;
    }
  }
  if (archiveEligible) {
    recommendations.push(
      'Run $harness-engineering:harness-archiver after the user explicitly requests stage closure.'
    );
  }

  const chain = await validateBaselineChain({root});
  const baseline = chain.valid
    ? {status: 'valid', stageId: chain.head}
    : chain.findings.some((item) => item.code === 'missing-baseline')
      ? {status: 'missing', stageId: null}
      : {status: 'invalid', stageId: chain.head};

  let branchOwnership = {status: 'unavailable'};
  try {
    const lease = await readBranchLease({
      root,
      threadId: process.env.CODEX_THREAD_ID ?? '__doctor-observer__'
    });
    branchOwnership = lease.status === 'foreign'
      ? {
        status: 'foreign',
        ownerThread: lease.lease.threadId,
        featureId: lease.lease.featureId
      }
      : {status: lease.status};
    if (lease.status === 'foreign') {
      recommendations.push(
        `Coordinate with branch owner thread ${lease.lease.threadId} before writing.`
      );
    }
  } catch {
    branchOwnership = {status: 'unavailable'};
  }

  let branchAlignment;
  try {
    const workspace = await discoverGitWorkspace(root);
    const branch = workspace.branch.replace(/^refs\/heads\//u, '');
    const mismatched = (featureState?.features ?? []).filter(
      (feature) => feature.status !== 'done' && feature.branch !== branch
    ).map((feature) => feature.id);
    branchAlignment = {
      status: mismatched.length === 0 ? 'aligned' : 'mismatched',
      branch,
      features: mismatched
    };
  } catch {
    branchAlignment = {status: 'unavailable'};
  }

  return {
    archiveEligible,
    baseline,
    branchOwnership,
    branchAlignment,
    recommendations
  };
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
    const assessment = await inspectHarness({
      root: options.target,
      manifestPath: options.manifestPath
    });
    const lifecycle = await inspectLifecycle(options.target);
    const report = lifecycle === null
      ? assessment
      : {...assessment, lifecycle};
    process.stdout.write(`${render(report, options)}\n`);
  } catch (error) {
    process.stderr.write(
      `Unable to inspect target: ${error.message}\n\n${USAGE}`
    );
    process.exitCode = 2;
  }
}

await main();
