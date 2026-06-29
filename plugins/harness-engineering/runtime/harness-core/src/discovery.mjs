import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_LIMITS } from './constants.mjs';
import { validateFeatureState } from './feature-state.mjs';
import { loadManifest } from './manifest.mjs';
import {
  readBoundedFile,
  statSafePath
} from './path-safety.mjs';

const rulesUrl = new URL('../rules/capabilities.json', import.meta.url);

function stableUnique(values) {
  return [...new Set(values)].sort(compareText);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function signalResult() {
  return {
    present: false,
    operational: false,
    evidence: [],
    gaps: [],
    unknowns: []
  };
}

function evidence(ruleId, source, result, detail) {
  return { ruleId, source, result, detail };
}

function finding(ruleId, source, code, detail) {
  return { ruleId, source, code, detail };
}

function sortRecords(records) {
  return records.sort((left, right) => {
    const leftKey = `${left.ruleId}\0${left.source ?? ''}\0${left.code ?? ''}\0${left.detail}`;
    const rightKey = `${right.ruleId}\0${right.source ?? ''}\0${right.code ?? ''}\0${right.detail}`;
    return compareText(leftKey, rightKey);
  });
}

async function loadRules() {
  return JSON.parse(await readFile(rulesUrl, 'utf8'));
}

function signalPaths(signal, manifest) {
  return stableUnique([
    ...(signal.conventionalPaths ?? []),
    ...(signal.manifestKey
      ? manifest.artifacts[signal.manifestKey] ?? []
      : [])
  ]);
}

async function inspectArtifact(root, signalId, signal, manifest, limits) {
  const result = signalResult();
  const declared = new Set(
    signal.manifestKey ? manifest.artifacts[signal.manifestKey] ?? [] : []
  );

  for (const source of signalPaths(signal, manifest)) {
    const file = await readBoundedFile(root, source, {
      maxBytes: limits.maxBytes
    });
    if (!file.ok) {
      if (file.reason !== 'missing' || declared.has(source)) {
        const target = file.reason === 'missing' ? result.gaps : result.unknowns;
        target.push(finding(
          signalId,
          source,
          file.reason === 'missing' ? 'declared-path-missing' : file.reason,
          file.reason === 'missing'
            ? 'Declared artifact does not exist.'
            : `Artifact could not be inspected: ${file.reason}.`
        ));
      }
      continue;
    }

    result.present = true;
    if (file.content.trim().length === 0) {
      result.evidence.push(evidence(
        signalId,
        source,
        'present',
        'Artifact exists but is empty.'
      ));
      result.gaps.push(finding(
        signalId,
        source,
        'empty-artifact',
        'Artifact must contain durable project information.'
      ));
      continue;
    }
    result.operational = true;
    result.evidence.push(evidence(
      signalId,
      source,
      'valid',
      'Readable non-empty artifact found.'
    ));
  }

  return result;
}

async function inspectFeatureState(root, signalId, signal, manifest, limits) {
  const result = signalResult();
  const declared = new Set(manifest.artifacts[signal.manifestKey] ?? []);

  for (const source of signalPaths(signal, manifest)) {
    const file = await readBoundedFile(root, source, {
      maxBytes: limits.maxBytes
    });
    if (!file.ok) {
      if (file.reason !== 'missing' || declared.has(source)) {
        const target = file.reason === 'missing' ? result.gaps : result.unknowns;
        target.push(finding(
          signalId,
          source,
          file.reason === 'missing' ? 'declared-path-missing' : file.reason,
          file.reason === 'missing'
            ? 'Declared feature state does not exist.'
            : `Feature state could not be inspected: ${file.reason}.`
        ));
      }
      continue;
    }

    result.present = true;
    let document;
    try {
      document = JSON.parse(file.content);
    } catch {
      result.evidence.push(evidence(
        signalId,
        source,
        'invalid',
        'Feature state is not valid JSON.'
      ));
      result.gaps.push(finding(
        signalId,
        source,
        'invalid-json',
        'Feature state must be valid JSON.'
      ));
      continue;
    }

    const validation = validateFeatureState(document);
    if (validation.valid) {
      result.operational = true;
      result.evidence.push(evidence(
        signalId,
        source,
        'valid',
        'Canonical feature state is valid.'
      ));
      continue;
    }

    result.evidence.push(evidence(
      signalId,
      source,
      'invalid',
      'Feature state is present but not operational.'
    ));
    for (const item of validation.findings) {
      result.gaps.push(finding(
        signalId,
        item.featureId ? `${source}#${item.featureId}` : source,
        item.code,
        item.detail
      ));
    }
  }

  return result;
}

function parseCommand(command) {
  if (typeof command !== 'string' || command.trim().length === 0
    || command.includes('\0') || command.includes('\n')) {
    return { ok: false, reason: 'invalid-command' };
  }
  const firstToken = command.trim().split(/\s+/, 1)[0];
  if (path.isAbsolute(firstToken)) {
    return { ok: false, reason: 'absolute-command-path' };
  }
  return {
    ok: true,
    command: command.trim(),
    executablePath: firstToken.startsWith('./') ? firstToken.slice(2) : null
  };
}

async function inspectDeclaredCommands(
  root,
  signalId,
  commands,
  result
) {
  for (const command of commands) {
    const parsed = parseCommand(command);
    const source = `command:${command}`;
    if (!parsed.ok) {
      result.unknowns.push(finding(
        signalId,
        source,
        parsed.reason,
        'Declared command is not safely inspectable.'
      ));
      continue;
    }

    result.present = true;
    if (parsed.executablePath === null) {
      result.operational = true;
      result.evidence.push(evidence(
        signalId,
        source,
        'valid',
        'Discoverable project command is declared.'
      ));
      continue;
    }

    const metadata = await statSafePath(root, parsed.executablePath);
    if (!metadata.ok) {
      const target = metadata.reason === 'missing'
        ? result.gaps
        : result.unknowns;
      target.push(finding(
        signalId,
        parsed.executablePath,
        metadata.reason === 'missing'
          ? 'command-target-missing'
          : metadata.reason,
        `Declared command target could not be used: ${metadata.reason}.`
      ));
      continue;
    }
    if (!metadata.executable) {
      result.evidence.push(evidence(
        signalId,
        parsed.executablePath,
        'present',
        'Declared command target exists but is not executable.'
      ));
      result.gaps.push(finding(
        signalId,
        parsed.executablePath,
        'not-executable',
        'Declared command target must be executable.'
      ));
      continue;
    }
    result.operational = true;
    result.evidence.push(evidence(
      signalId,
      parsed.executablePath,
      'valid',
      'Declared command target is executable.'
    ));
  }
}

async function inspectExecutable(root, signalId, signal, manifest) {
  const result = signalResult();
  for (const source of stableUnique(signal.conventionalPaths ?? [])) {
    const metadata = await statSafePath(root, source);
    if (!metadata.ok) {
      if (metadata.reason !== 'missing') {
        result.unknowns.push(finding(
          signalId,
          source,
          metadata.reason,
          `Executable could not be inspected: ${metadata.reason}.`
        ));
      }
      continue;
    }
    result.present = true;
    if (metadata.executable) {
      result.operational = true;
      result.evidence.push(evidence(
        signalId,
        source,
        'valid',
        'Executable project entrypoint found.'
      ));
    } else {
      result.evidence.push(evidence(
        signalId,
        source,
        'present',
        'Project entrypoint exists but is not executable.'
      ));
      result.gaps.push(finding(
        signalId,
        source,
        'not-executable',
        'Project entrypoint must be executable.'
      ));
    }
  }

  if (signal.manifestCommandKey) {
    await inspectDeclaredCommands(
      root,
      signalId,
      manifest.commands[signal.manifestCommandKey] ?? [],
      result
    );
  }
  return result;
}

async function inspectCommand(root, signalId, signal, manifest) {
  const result = signalResult();
  await inspectDeclaredCommands(
    root,
    signalId,
    manifest.commands[signal.manifestCommandKey] ?? [],
    result
  );
  return result;
}

async function inspectPackageScript(root, signalId, signal, _manifest, limits) {
  const result = signalResult();
  for (const source of signal.conventionalPaths ?? []) {
    const file = await readBoundedFile(root, source, {
      maxBytes: limits.maxBytes
    });
    if (!file.ok) {
      if (file.reason !== 'missing') {
        result.unknowns.push(finding(
          signalId,
          source,
          file.reason,
          `Package metadata could not be inspected: ${file.reason}.`
        ));
      }
      continue;
    }
    result.present = true;
    let packageDocument;
    try {
      packageDocument = JSON.parse(file.content);
    } catch {
      result.gaps.push(finding(
        signalId,
        source,
        'invalid-json',
        'Package metadata must be valid JSON.'
      ));
      continue;
    }
    const scripts = packageDocument.scripts;
    const found = (signal.scriptNames ?? []).filter((name) => (
      typeof scripts?.[name] === 'string' && scripts[name].trim().length > 0
    ));
    if (found.length > 0) {
      result.operational = true;
      result.evidence.push(evidence(
        signalId,
        source,
        'valid',
        `Verification scripts found: ${found.sort().join(', ')}.`
      ));
    } else {
      result.evidence.push(evidence(
        signalId,
        source,
        'present',
        'Package metadata has no recognized verification script.'
      ));
    }
  }
  return result;
}

const inspectors = {
  artifact: inspectArtifact,
  'feature-state': inspectFeatureState,
  executable: inspectExecutable,
  command: inspectCommand,
  'package-script': inspectPackageScript
};

function subsystemForManifestUnknown(item) {
  const key = item.ruleId.startsWith('manifest.artifacts.')
    ? item.ruleId.slice('manifest.artifacts.'.length)
    : null;
  return {
    instructions: 'instructions',
    context: 'instructions',
    featureState: 'state',
    progress: 'state',
    environment: 'environment',
    tools: 'tools',
    readinessEvidence: 'feedback'
  }[key] ?? null;
}

export async function discoverHarness({
  root,
  manifestPath,
  limits = {}
}) {
  const resolvedRoot = path.resolve(root);
  const rootMetadata = await stat(resolvedRoot);
  if (!rootMetadata.isDirectory()) {
    throw new Error(`Target is not a directory: ${root}`);
  }

  const effectiveLimits = { ...DEFAULT_LIMITS, ...limits };
  const [rules, manifestResult] = await Promise.all([
    loadRules(),
    loadManifest(resolvedRoot, {
      manifestPath,
      ...effectiveLimits
    })
  ]);
  const signals = {};
  for (const [signalId, signal] of Object.entries(rules.signals)) {
    const inspect = inspectors[signal.type];
    signals[signalId] = await inspect(
      resolvedRoot,
      signalId,
      signal,
      manifestResult.manifest,
      effectiveLimits
    );
    sortRecords(signals[signalId].evidence);
    sortRecords(signals[signalId].gaps);
    sortRecords(signals[signalId].unknowns);
  }

  const subsystemUnknowns = Object.fromEntries(
    rules.subsystemOrder.map((name) => [name, []])
  );
  const globalUnknowns = [];
  for (const item of manifestResult.unknowns) {
    const subsystem = subsystemForManifestUnknown(item);
    if (subsystem) {
      subsystemUnknowns[subsystem].push(item);
    } else {
      globalUnknowns.push(item);
    }
  }
  for (const values of Object.values(subsystemUnknowns)) {
    sortRecords(values);
  }
  sortRecords(globalUnknowns);

  return {
    root: resolvedRoot,
    rules,
    manifest: manifestResult,
    signals,
    subsystemUnknowns,
    globalUnknowns
  };
}
