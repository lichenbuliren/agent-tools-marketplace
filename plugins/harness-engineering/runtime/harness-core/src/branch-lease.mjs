import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  realpath,
  unlink,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const LEASE_FORMAT = 'harness-branch-lease/v1';
const TAKEOVER_FORMAT = 'harness-branch-takeover/v1';

function leaseError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requireThreadId(threadId = process.env.CODEX_THREAD_ID) {
  if (typeof threadId !== 'string' || threadId.trim() === '') {
    throw leaseError(
      'MISSING_THREAD_ID',
      'CODEX_THREAD_ID is required for branch lease operations.'
    );
  }
  return threadId;
}

function resolveGitPath(root, value) {
  return path.resolve(root, value.trim());
}

async function git(root, arguments_) {
  try {
    const result = await execFileAsync(
      'git',
      ['-C', root, ...arguments_],
      {encoding: 'utf8'}
    );
    return result.stdout.trim();
  } catch (error) {
    throw leaseError(
      'GIT_DISCOVERY_FAILED',
      `Git workspace discovery failed: ${error.stderr?.trim() || error.message}`
    );
  }
}

async function symbolicBranch(root) {
  try {
    return await git(root, ['symbolic-ref', '--quiet', 'HEAD']);
  } catch (error) {
    if (error.code === 'GIT_DISCOVERY_FAILED') {
      throw leaseError(
        'DETACHED_HEAD',
        'Branch lease operations require an attached Git branch.'
      );
    }
    throw error;
  }
}

export async function discoverGitWorkspace(root) {
  const worktree = await realpath(root).catch(() => {
    throw leaseError('INVALID_TARGET', 'Target repository could not be resolved.');
  });
  const [gitDirValue, commonDirValue, branch, head] = await Promise.all([
    git(worktree, ['rev-parse', '--git-dir']),
    git(worktree, ['rev-parse', '--git-common-dir']),
    symbolicBranch(worktree),
    git(worktree, ['rev-parse', 'HEAD'])
  ]);
  const gitDir = resolveGitPath(worktree, gitDirValue);
  const commonDir = resolveGitPath(worktree, commonDirValue);
  const branchHash = sha256(branch);
  return {
    worktree,
    gitDir,
    commonDir,
    branch,
    head,
    leasePath: path.join(
      commonDir,
      'harness-engineering',
      'leases',
      `${branchHash}.json`
    )
  };
}

async function readLeaseFile(workspace) {
  let content;
  try {
    content = await readFile(workspace.leasePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {content: null, lease: null};
    }
    throw error;
  }
  let lease;
  try {
    lease = JSON.parse(content);
  } catch {
    throw leaseError(
      'CORRUPT_LEASE',
      'Branch lease is not valid JSON.'
    );
  }
  if (lease?.format !== LEASE_FORMAT
    || lease.branch !== workspace.branch
    || typeof lease.threadId !== 'string'
    || typeof lease.leaseId !== 'string') {
    throw leaseError(
      'CORRUPT_LEASE',
      'Branch lease does not satisfy the v1 contract.'
    );
  }
  return {content, lease};
}

export async function readBranchLease({
  root,
  threadId = process.env.CODEX_THREAD_ID
}) {
  const owner = requireThreadId(threadId);
  const workspace = await discoverGitWorkspace(root);
  const {content, lease} = await readLeaseFile(workspace);
  if (lease === null) {
    return {
      status: 'missing',
      changed: false,
      workspace
    };
  }
  return {
    status: lease.threadId === owner ? 'owned' : 'foreign',
    changed: false,
    lease,
    leaseDigest: sha256(content),
    workspace
  };
}

export async function claimBranchLease({
  root,
  featureId,
  threadId = process.env.CODEX_THREAD_ID,
  now = () => new Date().toISOString(),
  createLeaseId = randomUUID
}) {
  const owner = requireThreadId(threadId);
  if (typeof featureId !== 'string' || featureId.trim() === '') {
    throw leaseError(
      'MISSING_FEATURE_ID',
      'A feature ID is required to claim a branch lease.'
    );
  }
  const workspace = await discoverGitWorkspace(root);
  await mkdir(path.dirname(workspace.leasePath), {recursive: true});
  const lease = {
    format: LEASE_FORMAT,
    branch: workspace.branch,
    featureId,
    threadId: owner,
    worktree: workspace.worktree,
    head: workspace.head,
    leaseId: createLeaseId(),
    acquiredAt: now()
  };
  const content = `${JSON.stringify(lease, null, 2)}\n`;
  try {
    await writeFile(workspace.leasePath, content, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    return {
      status: 'claimed',
      changed: true,
      lease,
      workspace
    };
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
  const current = await readLeaseFile(workspace);
  if (current.lease.threadId === owner) {
    return {
      status: 'owned',
      changed: false,
      lease: current.lease,
      workspace
    };
  }
  return {
    status: 'blocked',
    reason: 'branch-owned-by-another-thread',
    changed: false,
    lease: current.lease,
    workspace
  };
}

export async function releaseBranchLease({
  root,
  threadId = process.env.CODEX_THREAD_ID,
  leaseId
}) {
  const owner = requireThreadId(threadId);
  const workspace = await discoverGitWorkspace(root);
  const current = await readLeaseFile(workspace);
  if (current.lease === null) {
    return {
      status: 'missing',
      changed: false,
      workspace
    };
  }
  if (current.lease.threadId !== owner
    || current.lease.leaseId !== leaseId) {
    throw leaseError(
      'LEASE_OWNER_MISMATCH',
      'Only the matching branch lease owner can release the lease.'
    );
  }
  await unlink(workspace.leasePath);
  return {
    status: 'released',
    changed: true,
    lease: current.lease,
    workspace
  };
}

function takeoverPayload(workspace, current, threadId) {
  return {
    format: TAKEOVER_FORMAT,
    branch: workspace.branch,
    previousLeaseDigest: sha256(current.content),
    previousOwnerThread: current.lease.threadId,
    nextOwnerThread: threadId
  };
}

export async function planBranchLeaseTakeover({
  root,
  threadId = process.env.CODEX_THREAD_ID
}) {
  const owner = requireThreadId(threadId);
  const workspace = await discoverGitWorkspace(root);
  const current = await readLeaseFile(workspace);
  if (current.lease === null) {
    throw leaseError('LEASE_MISSING', 'No branch lease exists to take over.');
  }
  if (current.lease.threadId === owner) {
    throw leaseError(
      'LEASE_ALREADY_OWNED',
      'The current thread already owns this branch lease.'
    );
  }
  const payload = takeoverPayload(workspace, current, owner);
  return {
    ...payload,
    planId: sha256(JSON.stringify(payload))
  };
}

export async function applyBranchLeaseTakeover({
  root,
  featureId,
  planId,
  threadId = process.env.CODEX_THREAD_ID,
  now = () => new Date().toISOString(),
  createLeaseId = randomUUID
}) {
  const plan = await planBranchLeaseTakeover({root, threadId});
  if (plan.planId !== planId) {
    throw leaseError(
      'STALE_TAKEOVER_PLAN',
      `Takeover plan changed; current planId is ${plan.planId}.`
    );
  }
  const workspace = await discoverGitWorkspace(root);
  const current = await readLeaseFile(workspace);
  if (sha256(current.content) !== plan.previousLeaseDigest) {
    throw leaseError(
      'STALE_TAKEOVER_PLAN',
      'Branch lease changed after takeover planning.'
    );
  }
  await unlink(workspace.leasePath);
  return claimBranchLease({
    root,
    featureId,
    threadId,
    now,
    createLeaseId
  });
}
