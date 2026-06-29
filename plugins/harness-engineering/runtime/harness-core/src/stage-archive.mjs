import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { validateFeatureState } from './feature-state.mjs';

export const STAGE_FORMAT = 'harness-stage/v1';
const STAGE_ID_PATTERN = /^stage-[0-9a-f]{16}$/u;

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right, 'en'))
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function normalizePreviousBaseline(value) {
  return value === null || value === undefined || value === '' ? null : value;
}

export function createStageIdentity({
  featureStateContent,
  progressContent,
  previousBaseline,
  evolutionPath
}) {
  const featureState = JSON.parse(featureStateContent);
  const canonicalFeatureState = canonicalJson(featureState);
  const normalizedPreviousBaseline = normalizePreviousBaseline(previousBaseline);
  const closure = {
    evolutionPath,
    featureStateDigest: sha256(canonicalFeatureState),
    previousBaseline: normalizedPreviousBaseline,
    progressDigest: sha256(progressContent)
  };
  const digest = sha256(canonicalJson(closure));

  return {
    stageId: `stage-${digest.slice(0, 16)}`,
    digest,
    featureStateDigest: closure.featureStateDigest,
    featureStateArtifactDigest: sha256(featureStateContent),
    progressDigest: closure.progressDigest
  };
}

export function assessArchiveEligibility(featureState) {
  const validation = validateFeatureState(featureState);
  if (!validation.valid) {
    return {
      eligible: false,
      findings: validation.findings.map((item) => ({
        code: 'invalid-feature-state',
        detail: item.featureId === undefined
          ? item.detail
          : `${item.featureId}: ${item.detail}`
      }))
    };
  }
  if (featureState.features.length === 0) {
    return {
      eligible: false,
      findings: [{
        code: 'no-features',
        detail: 'A stage must contain at least one feature before archiving.'
      }]
    };
  }

  const findings = featureState.features
    .filter((feature) => feature.status !== 'done')
    .map((feature) => ({
      code: 'feature-not-done',
      detail: `Feature "${feature.id}" must be done before archiving.`
    }));
  return {
    eligible: findings.length === 0,
    findings
  };
}

export function createStageManifest({
  identity,
  previousBaseline,
  sourceHead,
  closedAt,
  evolutionPath,
  featureCount,
  passedEvidenceCount
}) {
  return {
    format: STAGE_FORMAT,
    stageId: identity.stageId,
    digest: identity.digest,
    previousBaseline: normalizePreviousBaseline(previousBaseline),
    sourceHead,
    closedAt,
    evolution: evolutionPath,
    artifacts: {
      featureState: {
        path: 'feature_list.json',
        digest: identity.featureStateArtifactDigest
      },
      progress: {
        path: 'progress.md',
        digest: identity.progressDigest
      }
    },
    summary: {
      featureCount,
      passedEvidenceCount
    }
  };
}

export function renderCompactedFeatureState({ mode }) {
  return `${JSON.stringify({
    schemaVersion: '1.1.0',
    mode,
    features: []
  }, null, 2)}\n`;
}

export function renderCompactedProgress({ stageId }) {
  return [
    '# Session Progress',
    '',
    `Latest archived baseline: \`${stageId}\`.`,
    '',
    'No active feature. Create the next scoped task in `feature_list.json`.',
    ''
  ].join('\n');
}

function chainFinding(code, detail, stageId) {
  return {
    ...(stageId === undefined ? {} : { stageId }),
    code,
    detail
  };
}

async function readText(filePath) {
  try {
    return { ok: true, content: await readFile(filePath, 'utf8') };
  } catch (error) {
    return { ok: false, error };
  }
}

function validManifestShape(manifest, stageId) {
  return manifest !== null
    && typeof manifest === 'object'
    && manifest.format === STAGE_FORMAT
    && manifest.stageId === stageId
    && typeof manifest.digest === 'string'
    && /^[0-9a-f]{64}$/u.test(manifest.digest)
    && (manifest.previousBaseline === null
      || STAGE_ID_PATTERN.test(manifest.previousBaseline))
    && typeof manifest.evolution === 'string'
    && manifest.evolution.length > 0
    && manifest.artifacts?.featureState?.path === 'feature_list.json'
    && typeof manifest.artifacts.featureState.digest === 'string'
    && manifest.artifacts?.progress?.path === 'progress.md'
    && typeof manifest.artifacts.progress.digest === 'string';
}

export async function validateBaselineChain({ root }) {
  const baseline = await readText(path.join(root, '.harness', 'baseline'));
  if (!baseline.ok) {
    return {
      valid: false,
      head: null,
      stages: [],
      findings: [chainFinding(
        'missing-baseline',
        'The .harness/baseline file is missing or unreadable.'
      )]
    };
  }

  const head = baseline.content.trim();
  if (!STAGE_ID_PATTERN.test(head)) {
    return {
      valid: false,
      head: head || null,
      stages: [],
      findings: [chainFinding(
        'invalid-baseline',
        'The baseline head must be a stage ID.'
      )]
    };
  }

  const stages = [];
  const findings = [];
  const visited = new Set();
  let current = head;
  while (current !== null) {
    if (visited.has(current)) {
      findings.push(chainFinding(
        'baseline-cycle',
        `Baseline chain contains a cycle at "${current}".`,
        current
      ));
      break;
    }
    visited.add(current);
    stages.push(current);

    const snapshotRoot = path.join(
      root,
      'docs',
      'evolution',
      'snapshots',
      current
    );
    const [manifestFile, featureFile, progressFile] = await Promise.all([
      readText(path.join(snapshotRoot, 'stage.json')),
      readText(path.join(snapshotRoot, 'feature_list.json')),
      readText(path.join(snapshotRoot, 'progress.md'))
    ]);
    if (!manifestFile.ok || !featureFile.ok || !progressFile.ok) {
      findings.push(chainFinding(
        'missing-snapshot-artifact',
        `Snapshot "${current}" is incomplete or unreadable.`,
        current
      ));
      break;
    }

    let manifest;
    try {
      manifest = JSON.parse(manifestFile.content);
    } catch {
      findings.push(chainFinding(
        'invalid-stage-manifest',
        `Snapshot "${current}" has invalid stage.json.`,
        current
      ));
      break;
    }
    if (!validManifestShape(manifest, current)) {
      findings.push(chainFinding(
        'invalid-stage-manifest',
        `Snapshot "${current}" does not satisfy ${STAGE_FORMAT}.`,
        current
      ));
      break;
    }

    let identity;
    try {
      identity = createStageIdentity({
        featureStateContent: featureFile.content,
        progressContent: progressFile.content,
        previousBaseline: manifest.previousBaseline,
        evolutionPath: manifest.evolution
      });
    } catch {
      findings.push(chainFinding(
        'invalid-snapshot-feature-state',
        `Snapshot "${current}" contains invalid feature JSON.`,
        current
      ));
      break;
    }

    const artifactsMatch = (
      manifest.artifacts.featureState.digest
        === sha256(featureFile.content)
      && manifest.artifacts.progress.digest === sha256(progressFile.content)
    );
    if (identity.stageId !== current
      || identity.digest !== manifest.digest
      || !artifactsMatch) {
      findings.push(chainFinding(
        'snapshot-digest-mismatch',
        `Snapshot "${current}" content does not match its manifest.`,
        current
      ));
      break;
    }
    current = manifest.previousBaseline;
  }

  return {
    valid: findings.length === 0,
    head,
    stages,
    findings
  };
}
