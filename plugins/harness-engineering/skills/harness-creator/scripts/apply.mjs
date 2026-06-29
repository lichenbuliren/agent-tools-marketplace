import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  rmdir,
  unlink,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import {
  claimBranchLease,
  inspectHarness,
  readBoundedFile,
  releaseBranchLease,
  resolveSafeWritePath,
  statSafePath,
  validateFeatureState
} from '../../../runtime/harness-core/src/index.mjs';
import { createPlan } from './planner.mjs';

const MAX_BYTES = 262_144;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function creatorError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function preflightAction(root, action) {
  if (action.operation === 'skip') {
    return;
  }
  const destination = await resolveSafeWritePath(root, action.path);
  if (!destination.ok) {
    throw creatorError(
      'UNSAFE_DESTINATION',
      `Unsafe destination ${action.path}: ${destination.reason}.`
    );
  }

  if (action.operation === 'create') {
    const state = await statSafePath(root, action.path);
    if (state.reason !== 'missing') {
      throw creatorError(
        'STALE_PLAN',
        `Create destination changed after planning: ${action.path}.`
      );
    }
    return;
  }

  if (action.operation === 'merge') {
    const current = await readBoundedFile(root, action.path, {
      maxBytes: MAX_BYTES
    });
    if (!current.ok || digest(current.content) !== action.precondition.sha256) {
      throw creatorError(
        'STALE_PLAN',
        `Merge source changed after planning: ${action.path}.`
      );
    }
    let document;
    try {
      document = JSON.parse(action.content);
    } catch {
      throw creatorError(
        'INVALID_PLAN',
        `Merge content is not valid JSON: ${action.path}.`
      );
    }
    if (!validateFeatureState(document).valid) {
      throw creatorError(
        'INVALID_PLAN',
        `Merge content violates canonical feature state: ${action.path}.`
      );
    }
  }
}

async function rollback(root, createdPaths, mergedFiles) {
  for (const item of [...mergedFiles].reverse()) {
    const current = await readBoundedFile(root, item.path, {
      maxBytes: MAX_BYTES
    });
    if (current.ok && digest(current.content) === digest(item.intended)) {
      await writeFile(item.absolutePath, item.original, 'utf8').catch(() => {});
    }
  }

  for (const item of [...createdPaths].reverse()) {
    const current = await readFile(item.absolutePath, 'utf8').catch(() => null);
    if (current === item.content) {
      await unlink(item.absolutePath).catch(() => {});
    }
    let parent = path.dirname(item.absolutePath);
    const rootPath = path.resolve(root);
    while (parent !== rootPath && parent.startsWith(`${rootPath}${path.sep}`)) {
      const removed = await rmdir(parent).then(() => true).catch(() => false);
      if (!removed) {
        break;
      }
      parent = path.dirname(parent);
    }
  }
}

export async function applyPlan({
  root,
  planId,
  agentFile = 'AGENTS.md',
  threadId = process.env.CODEX_THREAD_ID
}) {
  const plan = await createPlan({root, agentFile, threadId});
  if (plan.planId !== planId) {
    throw creatorError(
      'STALE_PLAN',
      `Plan ID does not match current target state. Current planId: ${plan.planId}.`
    );
  }
  const blocked = plan.actions.filter((action) => action.operation === 'block');
  if (blocked.length > 0) {
    throw creatorError(
      'BLOCKED_PLAN',
      `Plan contains blocked actions: ${blocked.map((item) => item.path).join(', ')}.`
    );
  }

  for (const action of plan.actions) {
    await preflightAction(root, action);
  }

  let temporaryLease = null;
  if (plan.git !== null && plan.lease.status === 'missing') {
    const claimed = await claimBranchLease({
      root,
      featureId: 'harness-creator',
      threadId
    });
    if (claimed.status === 'blocked') {
      throw creatorError(
        'BLOCKED_PLAN',
        'Another thread claimed the branch before apply; no files changed.'
      );
    }
    if (claimed.status === 'claimed') temporaryLease = claimed.lease;
  }
  const createdPaths = [];
  const mergedFiles = [];
  try {
    for (const action of plan.actions.filter(
      (item) => item.operation === 'create'
    )) {
      let destination = await resolveSafeWritePath(root, action.path);
      if (!destination.ok) {
        throw creatorError(
          'UNSAFE_DESTINATION',
          `Unsafe destination ${action.path}: ${destination.reason}.`
        );
      }
      await mkdir(path.dirname(destination.absolutePath), {recursive: true});
      destination = await resolveSafeWritePath(root, action.path);
      if (!destination.ok) {
        throw creatorError(
          'UNSAFE_DESTINATION',
          `Unsafe destination ${action.path}: ${destination.reason}.`
        );
      }
      await writeFile(destination.absolutePath, action.content, {
        encoding: 'utf8',
        flag: 'wx',
        mode: action.path.endsWith('.sh') ? 0o755 : 0o644
      });
      createdPaths.push({
        path: action.path,
        absolutePath: destination.absolutePath,
        content: action.content
      });
    }

    for (const action of plan.actions.filter(
      (item) => item.operation === 'merge'
    )) {
      const destination = await resolveSafeWritePath(root, action.path);
      const current = await readBoundedFile(root, action.path, {
        maxBytes: MAX_BYTES
      });
      if (!destination.ok || !current.ok
        || digest(current.content) !== action.precondition.sha256) {
        throw creatorError(
          'STALE_PLAN',
          `Merge source changed during apply: ${action.path}.`
        );
      }
      await writeFile(destination.absolutePath, action.content, 'utf8');
      mergedFiles.push({
        path: action.path,
        absolutePath: destination.absolutePath,
        original: current.content,
        intended: action.content
      });
    }

    const assessmentAfter = await inspectHarness({root});
    const results = plan.actions.map((action) => ({
      path: action.path,
      status: action.operation === 'create'
        ? 'created'
        : action.operation === 'merge'
          ? 'merged'
          : 'skipped',
      reason: action.reason
    }));
    return {
      schemaVersion: '1.0.0',
      target: '.',
      plan,
      results,
      assessmentAfter
    };
  } catch (error) {
    await rollback(root, createdPaths, mergedFiles);
    throw error;
  } finally {
    if (temporaryLease !== null) {
      await releaseBranchLease({
        root,
        threadId,
        leaseId: temporaryLease.leaseId
      });
    }
  }
}
