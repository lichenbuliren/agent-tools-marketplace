import {
  lstat,
  readFile,
  realpath,
  stat
} from 'node:fs/promises';
import path from 'node:path';

function isInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..'
      && !path.isAbsolute(relative));
}

function failure(relativePath, reason, extra = {}) {
  return {
    ok: false,
    relativePath,
    reason,
    ...extra
  };
}

export function normalizeDeclaredPath(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0
    || relativePath.includes('\0')) {
    return failure(relativePath, 'invalid-path');
  }
  if (path.isAbsolute(relativePath)) {
    return failure(relativePath, 'absolute-path');
  }

  const normalized = path.posix.normalize(relativePath.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../')) {
    return failure(relativePath, 'path-escapes-root');
  }

  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, normalized);
  if (!isInsideRoot(absoluteRoot, absolutePath)) {
    return failure(relativePath, 'path-escapes-root');
  }

  return {
    ok: true,
    relativePath: normalized,
    absolutePath
  };
}

export async function resolveSafeWritePath(root, relativePath) {
  const normalized = normalizeDeclaredPath(root, relativePath);
  if (!normalized.ok) {
    return normalized;
  }

  let realRoot;
  try {
    realRoot = await realpath(path.resolve(root));
  } catch {
    return failure(normalized.relativePath, 'unreadable-root');
  }

  let ancestor = path.dirname(normalized.absolutePath);
  while (true) {
    try {
      await lstat(ancestor);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        return failure(normalized.relativePath, 'unreadable-parent');
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        return failure(normalized.relativePath, 'unreadable-parent');
      }
      ancestor = parent;
    }
  }

  try {
    const realAncestor = await realpath(ancestor);
    if (!isInsideRoot(realRoot, realAncestor)) {
      return failure(normalized.relativePath, 'parent-escapes-root');
    }
  } catch {
    return failure(normalized.relativePath, 'unreadable-parent');
  }

  return normalized;
}

export async function statSafePath(root, relativePath) {
  const normalized = normalizeDeclaredPath(root, relativePath);
  if (!normalized.ok) {
    return normalized;
  }

  let entry;
  try {
    entry = await lstat(normalized.absolutePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return failure(normalized.relativePath, 'missing');
    }
    return failure(normalized.relativePath, 'unreadable');
  }

  let targetPath = normalized.absolutePath;
  if (entry.isSymbolicLink()) {
    try {
      const [realRoot, realTarget] = await Promise.all([
        realpath(path.resolve(root)),
        realpath(normalized.absolutePath)
      ]);
      if (!isInsideRoot(realRoot, realTarget)) {
        return failure(normalized.relativePath, 'symlink-escapes-root');
      }
      targetPath = realTarget;
      entry = await stat(realTarget);
    } catch {
      return failure(normalized.relativePath, 'unreadable-symlink');
    }
  }

  if (!entry.isFile()) {
    return failure(normalized.relativePath, 'not-file');
  }

  return {
    ok: true,
    relativePath: normalized.relativePath,
    absolutePath: normalized.absolutePath,
    targetPath,
    size: entry.size,
    executable: (entry.mode & 0o111) !== 0
  };
}

export async function readBoundedFile(
  root,
  relativePath,
  { maxBytes } = {}
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('maxBytes must be a positive safe integer');
  }

  const metadata = await statSafePath(root, relativePath);
  if (!metadata.ok) {
    return metadata;
  }
  if (metadata.size > maxBytes) {
    return failure(metadata.relativePath, 'file-too-large', {
      size: metadata.size,
      maxBytes
    });
  }

  try {
    const content = await readFile(metadata.targetPath, 'utf8');
    return {
      ok: true,
      relativePath: metadata.relativePath,
      content,
      size: metadata.size,
      executable: metadata.executable
    };
  } catch {
    return failure(metadata.relativePath, 'unreadable');
  }
}
