import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import {
  claimBranchLease,
  releaseBranchLease,
  renderCompactedFeatureState,
  renderCompactedProgress
} from '../../../runtime/harness-core/src/index.mjs';
import { createPlan } from './planner.mjs';

function archiveError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function restore(filePath, content) {
  if (content === null) await rm(filePath, {force: true});
  else await writeFile(filePath, content);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function completedApply(root, planId) {
  const baseline = (await readOptional(path.join(root, '.harness/baseline')))
    ?.trim();
  if (!baseline) return null;
  const manifestContent = await readOptional(path.join(
    root,
    'docs/evolution/snapshots',
    baseline,
    'stage.json'
  ));
  if (manifestContent === null) return null;
  try {
    const manifest = JSON.parse(manifestContent);
    return digest(JSON.stringify(manifest)) === planId
      ? {stageId: baseline, status: 'unchanged', plan: null}
      : null;
  } catch {
    return null;
  }
}

export async function applyPlan({
  root,
  evolutionPath,
  planId,
  threadId = process.env.CODEX_THREAD_ID,
  injectFailureAfter = null
}) {
  const completed = await completedApply(root, planId);
  if (completed !== null) return completed;

  const plan = await createPlan({root, evolutionPath, threadId});
  if (plan.stage !== null) {
    const currentManifest = await readOptional(path.join(
      root,
      'docs/evolution/snapshots',
      plan.stage.stageId,
      'stage.json'
    ));
    if (currentManifest !== null
      && currentManifest
        !== `${JSON.stringify(plan.stage.manifest, null, 2)}\n`) {
      throw archiveError(
        'SNAPSHOT_CONFLICT',
        `Snapshot ${plan.stage.stageId} already exists with different content.`
      );
    }
  }
  if (plan.planId !== planId) {
    throw archiveError(
      'STALE_PLAN',
      'The supplied planId does not match current target state.'
    );
  }
  if (!plan.eligible) {
    throw archiveError('BLOCKED_PLAN', 'The archive plan is blocked.');
  }

  const stageId = plan.stage.stageId;
  const snapshotRoot = path.join(
    root,
    'docs/evolution/snapshots',
    stageId
  );
  const existingManifest = await readOptional(path.join(snapshotRoot, 'stage.json'));
  if (existingManifest !== null) {
    const expected = `${JSON.stringify(plan.stage.manifest, null, 2)}\n`;
    if (existingManifest === expected) {
      return {stageId, status: 'unchanged', plan};
    }
    throw archiveError(
      'SNAPSHOT_CONFLICT',
      `Snapshot ${stageId} already exists with different content.`
    );
  }

  const claimed = await claimBranchLease({
    root,
    featureId: `archive:${stageId}`,
    threadId
  });
  if (claimed.status === 'blocked') {
    throw archiveError(
      'FOREIGN_LEASE',
      'Another thread owns the branch; no files changed.'
    );
  }
  const releaseAfter = claimed.status === 'claimed';
  const featurePath = path.join(root, 'feature_list.json');
  const progressPath = path.join(root, 'progress.md');
  const baselinePath = path.join(root, '.harness/baseline');
  const originals = {
    feature: await readOptional(featurePath),
    progress: await readOptional(progressPath),
    baseline: await readOptional(baselinePath)
  };
  const staging = `${snapshotRoot}.tmp-${process.pid}`;
  let writes = 0;
  const checkpoint = () => {
    writes += 1;
    if (writes === injectFailureAfter) {
      throw archiveError('INJECTED_FAILURE', 'Injected archive failure.');
    }
  };

  try {
    await mkdir(path.dirname(snapshotRoot), {recursive: true});
    await mkdir(staging, {recursive: false});
    await writeFile(
      path.join(staging, 'feature_list.json'),
      originals.feature,
      {flag: 'wx'}
    );
    checkpoint();
    await writeFile(
      path.join(staging, 'progress.md'),
      originals.progress,
      {flag: 'wx'}
    );
    checkpoint();
    await writeFile(
      path.join(staging, 'stage.json'),
      `${JSON.stringify(plan.stage.manifest, null, 2)}\n`,
      {flag: 'wx'}
    );
    checkpoint();
    await rename(staging, snapshotRoot);
    await writeFile(
      featurePath,
      renderCompactedFeatureState({
        mode: JSON.parse(originals.feature).mode
      })
    );
    checkpoint();
    await writeFile(
      progressPath,
      renderCompactedProgress({stageId})
    );
    checkpoint();
    await writeFile(baselinePath, `${stageId}\n`);
    checkpoint();
  } catch (error) {
    await rm(staging, {recursive: true, force: true});
    await rm(snapshotRoot, {recursive: true, force: true});
    await restore(featurePath, originals.feature);
    await restore(progressPath, originals.progress);
    await restore(baselinePath, originals.baseline);
    throw error;
  } finally {
    if (releaseAfter) {
      await releaseBranchLease({
        root,
        threadId,
        leaseId: claimed.lease.leaseId
      });
    }
  }
  return {stageId, status: 'archived', plan};
}
