import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  assessArchiveEligibility,
  createStageIdentity,
  createStageManifest,
  discoverGitWorkspace,
  normalizeDeclaredPath
} from '../../../runtime/harness-core/src/index.mjs';

const execFileAsync = promisify(execFile);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function git(root, args) {
  const result = await execFileAsync('git', ['-C', root, ...args], {
    encoding: 'utf8'
  });
  return result.stdout.trim();
}

async function optionalText(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function finding(code, detail) {
  return {code, detail};
}

function stablePlanId(plan) {
  return sha256(JSON.stringify(plan));
}

async function leaseState(workspace, threadId) {
  const content = await optionalText(workspace.leasePath);
  if (content === null) return {status: 'missing'};
  try {
    const lease = JSON.parse(content);
    return {
      status: threadId && lease.threadId === threadId ? 'owned' : 'foreign',
      ownerThread: lease.threadId,
      featureId: lease.featureId
    };
  } catch {
    return {status: 'corrupt'};
  }
}

export async function createPlan({
  root,
  evolutionPath,
  threadId = process.env.CODEX_THREAD_ID
}) {
  const findings = [];
  let workspace;
  try {
    workspace = await discoverGitWorkspace(root);
  } catch (error) {
    findings.push(finding(
      error.code === 'DETACHED_HEAD' ? 'detached-head' : 'git-unavailable',
      error.message
    ));
  }

  let sourceHead = null;
  let closedAt = null;
  let branch = null;
  let dirty = false;
  if (workspace) {
    sourceHead = workspace.head;
    branch = workspace.branch.replace(/^refs\/heads\//u, '');
    closedAt = await git(root, ['show', '-s', '--format=%cI', 'HEAD']);
    dirty = (await git(root, ['status', '--porcelain', '--untracked-files=all']))
      .length > 0;
    if (dirty) {
      findings.push(finding(
        'dirty-worktree',
        'Commit or remove worktree changes before archiving.'
      ));
    }
  }

  const normalizedEvolution = normalizeDeclaredPath(root, evolutionPath);
  if (!normalizedEvolution.ok
    || !normalizedEvolution.relativePath.startsWith('docs/evolution/')
    || normalizedEvolution.relativePath.includes('/snapshots/')) {
    findings.push(finding(
      'unsafe-evolution-path',
      'Evolution evidence must be a file under docs/evolution/.'
    ));
  }
  let evolutionContent = null;
  if (normalizedEvolution.ok) {
    evolutionContent = await optionalText(normalizedEvolution.absolutePath);
    if (evolutionContent === null) {
      findings.push(finding(
        'missing-evolution',
        'The declared evolution evidence file does not exist.'
      ));
    } else if (!(await stat(normalizedEvolution.absolutePath)).isFile()) {
      findings.push(finding(
        'invalid-evolution',
        'The declared evolution evidence path must be a file.'
      ));
    }
  }

  const featureStateContent = await optionalText(path.join(root, 'feature_list.json'));
  const progressContent = await optionalText(path.join(root, 'progress.md'));
  let featureState = null;
  if (featureStateContent === null || progressContent === null) {
    findings.push(finding(
      'missing-current-state',
      'feature_list.json and progress.md are required.'
    ));
  } else {
    try {
      featureState = JSON.parse(featureStateContent);
      findings.push(...assessArchiveEligibility(featureState).findings);
    } catch {
      findings.push(finding(
        'invalid-feature-state',
        'feature_list.json must contain valid JSON.'
      ));
    }
  }

  const baselineContent = await optionalText(path.join(root, '.harness/baseline'));
  const previousBaseline = baselineContent?.trim() || null;
  const lease = workspace
    ? await leaseState(workspace, threadId)
    : {status: 'unavailable'};
  if (lease.status === 'foreign') {
    findings.push(finding(
      'foreign-lease',
      `Branch is owned by thread ${lease.ownerThread}; no files may change.`
    ));
  } else if (lease.status === 'corrupt') {
    findings.push(finding('corrupt-lease', 'Branch lease is invalid.'));
  }

  let identity = null;
  let manifest = null;
  if (featureState && progressContent !== null && normalizedEvolution.ok) {
    identity = createStageIdentity({
      featureStateContent,
      progressContent,
      previousBaseline,
      evolutionPath: normalizedEvolution.relativePath
    });
    manifest = createStageManifest({
      identity,
      previousBaseline,
      sourceHead: sourceHead ?? '0'.repeat(40),
      closedAt: closedAt ?? '1970-01-01T00:00:00.000Z',
      evolutionPath: normalizedEvolution.relativePath,
      featureCount: featureState.features?.length ?? 0,
      passedEvidenceCount: (featureState.features ?? [])
        .flatMap((feature) => feature.evidence ?? [])
        .filter((item) => item.status === 'passed').length
    });
  }

  const snapshotRoot = identity
    ? `docs/evolution/snapshots/${identity.stageId}`
    : 'docs/evolution/snapshots/<blocked>';
  const actions = [
    ['.harness/baseline', 'link'],
    ['feature_list.json', 'compact'],
    ['progress.md', 'compact'],
    [`${snapshotRoot}/feature_list.json`, 'create'],
    [`${snapshotRoot}/progress.md`, 'create'],
    [`${snapshotRoot}/stage.json`, 'create']
  ].map(([actionPath, operation]) => ({
    path: actionPath,
    operation: findings.length === 0 ? operation : 'block'
  })).sort((left, right) => left.path.localeCompare(right.path, 'en'));

  const body = {
    schemaVersion: '1.0.0',
    target: '.',
    eligible: findings.length === 0,
    stage: identity ? {
      stageId: identity.stageId,
      digest: identity.digest,
      manifest
    } : null,
    git: {
      branch,
      sourceHead,
      closedAt,
      dirty
    },
    lease,
    previousBaseline,
    findings,
    actions,
    source: featureStateContent === null || progressContent === null ? null : {
      featureStateDigest: sha256(featureStateContent),
      progressDigest: sha256(progressContent),
      evolutionDigest: evolutionContent === null ? null : sha256(evolutionContent)
    }
  };
  return {
    ...body,
    planId: body.eligible
      ? stablePlanId(body.stage.manifest)
      : stablePlanId(body)
  };
}
