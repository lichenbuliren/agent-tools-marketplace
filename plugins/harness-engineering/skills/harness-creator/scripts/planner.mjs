import { createHash } from 'node:crypto';

import {
  discoverGitWorkspace,
  inspectHarness,
  readBranchLease,
  readBoundedFile,
  statSafePath,
  validateFeatureState
} from '../../../runtime/harness-core/src/index.mjs';
import {
  contextRestorationFeature,
  renderAgentInstructions,
  renderFeatureState,
  renderInit,
  renderManifest,
  renderProgress
} from './templates.mjs';

const MAX_BYTES = 262_144;
const ENVIRONMENT_CANDIDATES = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts'
];

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function evidenceFor(assessment, ruleId, result = 'valid') {
  return Object.values(assessment.subsystems)
    .flatMap((subsystem) => subsystem.evidence)
    .filter((item) => item.ruleId === ruleId && item.result === result);
}

function firstArtifactSource(assessment, ruleId, result = 'valid') {
  return evidenceFor(assessment, ruleId, result)
    .map((item) => item.source)
    .find((source) => !source.startsWith('command:'));
}

function createAction(path, capability, content, reason) {
  return {
    path,
    capability,
    operation: 'create',
    reason,
    precondition: {kind: 'missing'},
    content
  };
}

function skipAction(path, capability, reason) {
  return {
    path,
    capability,
    operation: 'skip',
    reason,
    precondition: {kind: 'present'}
  };
}

function blockAction(path, capability, reason) {
  return {
    path,
    capability,
    operation: 'block',
    reason,
    precondition: {kind: 'blocked'}
  };
}

function mergeAction(path, capability, currentContent, content, reason) {
  return {
    path,
    capability,
    operation: 'merge',
    reason,
    precondition: {
      kind: 'sha256',
      sha256: digest(currentContent)
    },
    content
  };
}

async function existingPaths(root, candidates) {
  const paths = [];
  for (const candidate of candidates) {
    const result = await statSafePath(root, candidate);
    if (result.ok) {
      paths.push(result.relativePath);
    }
  }
  return paths;
}

async function readOptional(root, relativePath) {
  const result = await readBoundedFile(root, relativePath, {
    maxBytes: MAX_BYTES
  });
  return result.ok ? result.content : null;
}

async function detectProject(root, assessment) {
  const declaredEnvironment = evidenceFor(
    assessment,
    'environment.file'
  ).map((item) => item.source);
  const environmentPaths = declaredEnvironment.length > 0
    ? [...new Set(declaredEnvironment)].sort(compareText)
    : await existingPaths(root, ENVIRONMENT_CANDIDATES);
  const commands = [];

  if (environmentPaths.includes('package.json')) {
    const packageContent = await readOptional(root, 'package.json');
    if (packageContent !== null) {
      try {
        const packageDocument = JSON.parse(packageContent);
        const scripts = packageDocument.scripts ?? {};
        const packageManager = (await statSafePath(root, 'pnpm-lock.yaml')).ok
          ? 'pnpm'
          : (await statSafePath(root, 'yarn.lock')).ok
            ? 'yarn'
            : (await statSafePath(root, 'bun.lock')).ok
              || (await statSafePath(root, 'bun.lockb')).ok
              ? 'bun'
              : 'npm';
        for (const name of [
          'check',
          'typecheck',
          'type-check',
          'lint',
          'test',
          'build'
        ]) {
          if (typeof scripts[name] !== 'string') {
            continue;
          }
          if (name === 'test') {
            commands.push(packageManager === 'npm' ? 'npm test' : `${packageManager} test`);
          } else if (packageManager === 'yarn') {
            commands.push(`yarn ${name}`);
          } else {
            commands.push(`${packageManager} run ${name}`);
          }
        }
      } catch {
        // Invalid project metadata is reported by inspection; do not guess.
      }
    }
  } else if (environmentPaths.includes('go.mod')) {
    commands.push('go test ./...');
  } else if (environmentPaths.includes('Cargo.toml')) {
    commands.push('cargo test');
  } else if (environmentPaths.includes('pom.xml')) {
    commands.push('mvn test');
  } else if (
    environmentPaths.includes('build.gradle')
    || environmentPaths.includes('build.gradle.kts')
  ) {
    commands.push('./gradlew test');
  } else if (
    environmentPaths.includes('pyproject.toml')
    || environmentPaths.includes('requirements.txt')
  ) {
    commands.push('python -m pytest');
  }

  return {
    environmentPaths,
    verificationCommands: [...new Set(commands)]
  };
}

async function planFeatureState({
  root,
  assessment,
  needsContext
}) {
  const validSource = firstArtifactSource(
    assessment,
    'state.feature',
    'valid'
  );
  const invalidSource = firstArtifactSource(
    assessment,
    'state.feature',
    'invalid'
  );

  if (!validSource && invalidSource) {
    return blockAction(
      invalidSource,
      'state',
      'Existing feature state is not canonical and will not be rewritten.'
    );
  }
  if (!validSource) {
    return createAction(
      'feature_list.json',
      'state',
      renderFeatureState({needsContext}),
      needsContext
        ? 'Create canonical feature state with the required context restoration task.'
        : 'Create empty canonical feature state without inventing project work.'
    );
  }
  if (!needsContext) {
    return skipAction(
      validSource,
      'state',
      'Canonical feature state already exists and context is operational.'
    );
  }

  const currentContent = await readOptional(root, validSource);
  if (currentContent === null) {
    return blockAction(
      validSource,
      'state',
      'Canonical feature state could not be read safely.'
    );
  }
  const document = JSON.parse(currentContent);
  const existing = document.features.find(
    (feature) => feature.id === 'harness-context-restoration'
  );
  if (existing) {
    return existing.name === 'Project Context Restoration'
      ? skipAction(
        validSource,
        'state',
        'The context restoration task already exists.'
      )
      : blockAction(
        validSource,
        'state',
        'The reserved context restoration feature ID is already used by different project work.'
      );
  }

  const active = document.features.some(
    (feature) => feature.status === 'next' || feature.status === 'in-progress'
  );
  const status = document.mode === 'serial' && active ? 'not-started' : 'next';
  const merged = {
    ...document,
    features: [
      ...document.features,
      contextRestorationFeature(status)
    ]
  };
  if (!validateFeatureState(merged).valid) {
    return blockAction(
      validSource,
      'state',
      'The context task cannot be merged without violating feature-state invariants.'
    );
  }

  return mergeAction(
    validSource,
    'state',
    currentContent,
    `${JSON.stringify(merged, null, 2)}\n`,
    'Add the real context restoration task while preserving existing project features.'
  );
}

async function planExistingOrCreate({
  root,
  path,
  existingPath,
  preserveExisting = false,
  capability,
  content,
  createReason,
  skipReason
}) {
  const candidate = existingPath ?? path;
  const state = await statSafePath(root, candidate);
  if (state.ok) {
    return existingPath !== undefined || preserveExisting
      ? skipAction(candidate, capability, skipReason)
      : blockAction(
        candidate,
        capability,
        'An existing destination does not satisfy the capability and will not be overwritten.'
      );
  }
  if (state.reason !== 'missing') {
    return blockAction(
      candidate,
      capability,
      `Destination is unsafe or unreadable: ${state.reason}.`
    );
  }
  return createAction(path, capability, content, createReason);
}

export async function createPlan({
  root,
  agentFile = 'AGENTS.md',
  threadId = process.env.CODEX_THREAD_ID
}) {
  if (!['AGENTS.md', 'CLAUDE.md'].includes(agentFile)) {
    throw new Error('agentFile must be AGENTS.md or CLAUDE.md.');
  }

  const assessment = await inspectHarness({root});
  const project = await detectProject(root, assessment);
  const needsContext = evidenceFor(assessment, 'context.file').length === 0;
  const instructionPath = firstArtifactSource(assessment, 'instructions.file');
  const progressPath = firstArtifactSource(assessment, 'state.progress');
  const initializePath = firstArtifactSource(
    assessment,
    'initialize.executable'
  );
  const contextPath = firstArtifactSource(assessment, 'context.file')
    ?? 'CONTEXT.md';
  const featureAction = await planFeatureState({
    root,
    assessment,
    needsContext
  });
  const finalInstructionPath = instructionPath ?? agentFile;
  const finalProgressPath = progressPath ?? 'progress.md';
  const finalInitializePath = initializePath ?? 'init.sh';
  const actions = [
    await planExistingOrCreate({
      root,
      path: agentFile,
      existingPath: instructionPath,
      capability: 'instructions',
      content: renderAgentInstructions({
        agentFile,
        verificationCommands: project.verificationCommands
      }),
      createReason: 'Create the minimal root agent operating contract.',
      skipReason: 'An operational instruction artifact already exists.'
    }),
    featureAction,
    await planExistingOrCreate({
      root,
      path: 'progress.md',
      existingPath: progressPath,
      capability: 'state',
      content: renderProgress({needsContext}),
      createReason: 'Create the default session continuity surface.',
      skipReason: 'An operational progress artifact already exists.'
    })
  ];

  const requiredPaths = [
    finalInstructionPath,
    featureAction.path,
    finalProgressPath,
    '.harness/manifest.json'
  ];
  if (!needsContext) {
    requiredPaths.push(contextPath);
  }
  actions.push(await planExistingOrCreate({
    root,
    path: 'init.sh',
    existingPath: initializePath,
    capability: 'environment',
    content: renderInit({
      requiredPaths: [...new Set(requiredPaths)].sort(compareText),
      verificationCommands: project.verificationCommands
    }),
    createReason: 'Create a check-first initialization entrypoint.',
    skipReason: 'An operational initialization entrypoint already exists.'
  }));

  const manifestState = await statSafePath(root, '.harness/manifest.json');
  if (manifestState.ok) {
    actions.push(skipAction(
      '.harness/manifest.json',
      'tools',
      'A harness manifest already exists and will be preserved.'
    ));
  } else if (manifestState.reason === 'missing') {
    actions.push(createAction(
      '.harness/manifest.json',
      'tools',
      renderManifest({
        agentFile: finalInstructionPath,
        contextPath,
        featureStatePath: featureAction.path,
        progressPath: finalProgressPath,
        initPath: finalInitializePath,
        environmentPaths: project.environmentPaths,
        verificationCommands: project.verificationCommands
      }),
      'Create the canonical capability manifest.'
    ));
  } else {
    actions.push(blockAction(
      '.harness/manifest.json',
      'tools',
      `Manifest destination is unsafe or unreadable: ${manifestState.reason}.`
    ));
  }

  actions.sort((left, right) => compareText(left.path, right.path));
  let git = null;
  let lease = {status: 'not-managed'};
  const gitMarker = await statSafePath(root, '.git');
  if (gitMarker.ok || gitMarker.reason === 'not-file') {
    try {
      const workspace = await discoverGitWorkspace(root);
      git = {
        branch: workspace.branch.replace(/^refs\/heads\//u, ''),
        head: workspace.head
      };
      const observed = await readBranchLease({
        root,
        threadId: threadId ?? '__unidentified-thread__'
      });
      lease = observed.status === 'foreign'
        ? {
          status: 'foreign',
          ownerThread: observed.lease.threadId,
          featureId: observed.lease.featureId
        }
        : {status: observed.status};
    } catch (error) {
      lease = {status: 'unavailable', reason: error.code ?? error.message};
    }
  }
  if (lease.status === 'foreign') {
    for (let index = 0; index < actions.length; index += 1) {
      if (actions[index].operation !== 'skip') {
        actions[index] = {
          ...actions[index],
          operation: 'block',
          reason: `Another thread (${lease.ownerThread}) owns this branch; no files may change.`
        };
      }
    }
  }
  const payload = {
    schemaVersion: '1.0.0',
    target: '.',
    assessmentBefore: assessment,
    options: {
      agentFile
    },
    git,
    lease,
    actions
  };

  return {
    ...payload,
    planId: digest(JSON.stringify(payload))
  };
}
