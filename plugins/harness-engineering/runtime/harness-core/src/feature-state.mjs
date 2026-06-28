const FEATURE_STATUSES = new Set([
  'not-started',
  'next',
  'in-progress',
  'blocked',
  'done'
]);

const ACTIVE_STATUSES = new Set(['next', 'in-progress']);
const UNFINISHED_STATUSES = new Set(['not-started', 'next', 'in-progress']);
export const FEATURE_STATE_SCHEMA_VERSION = '1.1.0';
export const LEGACY_FEATURE_STATE_SCHEMA_VERSION = '1.0.0';
const SUPPORTED_SCHEMA_VERSIONS = new Set([
  LEGACY_FEATURE_STATE_SCHEMA_VERSION,
  FEATURE_STATE_SCHEMA_VERSION
]);

function finding(code, detail, featureId) {
  return {
    ...(featureId === undefined ? {} : { featureId }),
    code,
    detail
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isValidBranch(value) {
  if (!isNonEmptyString(value)
    || value === '@'
    || value.startsWith('-')
    || value.startsWith('/')
    || value.endsWith('/')
    || value.endsWith('.')
    || value.includes('..')
    || value.includes('//')
    || value.includes('@{')
    || /[\u0000-\u0020\u007f~^:?*[\]\\]/u.test(value)) {
    return false;
  }
  return value.split('/').every((part) => (
    part.length > 0
    && !part.startsWith('.')
    && !part.endsWith('.lock')
  ));
}

function validVerification(value) {
  return value === null || (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && ['command', 'manual'].includes(value.kind)
    && Array.isArray(value.steps)
    && value.steps.length > 0
    && value.steps.every(isNonEmptyString)
  );
}

function validEvidence(value, verification) {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
      || !['passed', 'failed', 'blocked'].includes(entry.status)
      || !isNonEmptyString(entry.summary)) {
      return false;
    }
    if (entry.verificationStep === undefined) {
      return true;
    }
    return Number.isInteger(entry.verificationStep)
      && entry.verificationStep >= 0
      && verification !== null
      && Array.isArray(verification?.steps)
      && entry.verificationStep < verification.steps.length;
  });
}

function sortFindings(findings) {
  return findings.sort((left, right) => {
    if (left.featureId === undefined && right.featureId !== undefined) {
      return -1;
    }
    if (left.featureId !== undefined && right.featureId === undefined) {
      return 1;
    }
    const featureOrder = String(left.featureId ?? '')
      .localeCompare(String(right.featureId ?? ''), 'en');
    if (featureOrder !== 0) {
      return featureOrder;
    }
    const codeOrder = left.code.localeCompare(right.code, 'en');
    return codeOrder !== 0
      ? codeOrder
      : left.detail.localeCompare(right.detail, 'en');
  });
}

function findDependencyCycles(features, byId) {
  const findings = [];
  const complete = new Set();
  const stack = [];
  const stackIndexes = new Map();
  const recorded = new Set();

  function visit(id) {
    if (complete.has(id)) {
      return;
    }
    if (stackIndexes.has(id)) {
      const cycle = stack.slice(stackIndexes.get(id));
      const cycleKey = [...cycle].sort().join('\0');
      if (!recorded.has(cycleKey)) {
        recorded.add(cycleKey);
        const featureId = [...cycle].sort()[0];
        findings.push(finding(
          'dependency-cycle',
          `Dependency cycle detected: ${[...cycle, id].join(' -> ')}.`,
          featureId
        ));
      }
      return;
    }

    stackIndexes.set(id, stack.length);
    stack.push(id);
    const feature = byId.get(id);
    for (const dependency of feature?.dependencies ?? []) {
      if (byId.has(dependency) && dependency !== id) {
        visit(dependency);
      }
    }
    stack.pop();
    stackIndexes.delete(id);
    complete.add(id);
  }

  for (const feature of features) {
    if (isNonEmptyString(feature.id)) {
      visit(feature.id);
    }
  }
  return findings;
}

function validateFeatureShape(feature, index, findings, schemaVersion) {
  if (feature === null || typeof feature !== 'object' || Array.isArray(feature)) {
    findings.push(finding(
      'invalid-feature',
      `Feature at index ${index} must be an object.`
    ));
    return false;
  }

  const featureId = isNonEmptyString(feature.id)
    ? feature.id
    : `#${index}`;
  let structurallyValid = true;
  const requireString = (key) => {
    if (!isNonEmptyString(feature[key])) {
      findings.push(finding(
        `invalid-${key}`,
        `Feature ${key} must be a non-empty string.`,
        featureId
      ));
      structurallyValid = false;
    }
  };

  requireString('id');
  requireString('name');
  if (!isNonEmptyString(feature.behavior)) {
    findings.push(finding(
      isNonEmptyString(feature.description)
        ? 'legacy-description'
        : 'invalid-behavior',
      isNonEmptyString(feature.description)
        ? 'Rename legacy description to behavior.'
        : 'Feature behavior must be a non-empty string.',
      featureId
    ));
    structurallyValid = false;
  }
  if (!Array.isArray(feature.dependencies)
    || feature.dependencies.some((item) => !isNonEmptyString(item))) {
    findings.push(finding(
      'invalid-dependencies',
      'Feature dependencies must be an array of non-empty IDs.',
      featureId
    ));
    structurallyValid = false;
  }
  if (!FEATURE_STATUSES.has(feature.status)) {
    findings.push(finding(
      'invalid-status',
      'Feature status is not canonical.',
      featureId
    ));
    structurallyValid = false;
  }
  if (schemaVersion === FEATURE_STATE_SCHEMA_VERSION) {
    if (feature.branch === null) {
      if (feature.status !== 'done') {
        findings.push(finding(
          'missing-active-branch',
          'An unfinished feature requires a Git branch.',
          featureId
        ));
        structurallyValid = false;
      }
    } else if (!isValidBranch(feature.branch)) {
      findings.push(finding(
        Object.hasOwn(feature, 'branch')
          ? 'invalid-branch'
          : 'missing-active-branch',
        'Feature branch must be null for migrated done work or a valid Git branch.',
        featureId
      ));
      structurallyValid = false;
    }
  }
  if (!Object.hasOwn(feature, 'verification')) {
    findings.push(finding(
      'missing-verification',
      'Feature verification must be present, using null when not defined.',
      featureId
    ));
    structurallyValid = false;
  } else if (!validVerification(feature.verification)) {
    findings.push(finding(
      'invalid-verification',
      'Feature verification must be null or contain a kind and ordered steps.',
      featureId
    ));
    structurallyValid = false;
  }
  if (!validEvidence(feature.evidence, feature.verification)) {
    findings.push(finding(
      'invalid-evidence',
      'Feature evidence must be an array of structured observations.',
      featureId
    ));
    structurallyValid = false;
  }

  return structurallyValid;
}

export function validateFeatureState(document) {
  const findings = [];
  if (document === null || typeof document !== 'object'
    || Array.isArray(document)) {
    return {
      valid: false,
      canonical: false,
      findings: [finding(
        'invalid-document',
        'Feature state must be a JSON object.'
      )]
    };
  }

  if (!SUPPORTED_SCHEMA_VERSIONS.has(document.schemaVersion)) {
    findings.push(finding(
      document.schemaVersion === undefined
        ? 'missing-schema-version'
        : 'unsupported-schema-version',
      `Feature state schemaVersion must be "${FEATURE_STATE_SCHEMA_VERSION}" or "${LEGACY_FEATURE_STATE_SCHEMA_VERSION}".`
    ));
  }
  if (!['serial', 'parallel'].includes(document.mode)) {
    findings.push(finding(
      document.mode === undefined ? 'missing-mode' : 'invalid-mode',
      'Feature state mode must be serial or parallel.'
    ));
  }
  if (!Array.isArray(document.features)) {
    findings.push(finding(
      'invalid-features',
      'Feature state features must be an array.'
    ));
    return {
      valid: false,
      canonical: false,
      findings: sortFindings(findings)
    };
  }

  const shapeValidity = document.features.map((feature, index) => (
    validateFeatureShape(feature, index, findings, document.schemaVersion)
  ));
  const usableFeatures = document.features.filter((feature, index) => (
    shapeValidity[index]
    && isNonEmptyString(feature.id)
    && Array.isArray(feature.dependencies)
    && FEATURE_STATUSES.has(feature.status)
  ));
  const counts = new Map();
  for (const feature of usableFeatures) {
    counts.set(feature.id, (counts.get(feature.id) ?? 0) + 1);
  }
  for (const [id, count] of counts) {
    if (count > 1) {
      findings.push(finding(
        'duplicate-id',
        `Feature ID "${id}" appears ${count} times.`,
        id
      ));
    }
  }

  const byId = new Map();
  for (const feature of usableFeatures) {
    if (!byId.has(feature.id)) {
      byId.set(feature.id, feature);
    }
  }
  for (const feature of usableFeatures) {
    const uniqueDependencies = new Set();
    for (const dependency of feature.dependencies) {
      if (uniqueDependencies.has(dependency)) {
        findings.push(finding(
          'duplicate-dependency',
          `Dependency "${dependency}" is listed more than once.`,
          feature.id
        ));
      }
      uniqueDependencies.add(dependency);
      if (dependency === feature.id) {
        findings.push(finding(
          'self-dependency',
          'A feature cannot depend on itself.',
          feature.id
        ));
      } else if (!byId.has(dependency)) {
        findings.push(finding(
          'missing-dependency',
          `Dependency "${dependency}" does not reference an existing feature.`,
          feature.id
        ));
      }
    }

    if (feature.status === 'done') {
      if (feature.verification === null) {
        findings.push(finding(
          'done-without-verification',
          'A done feature requires a verification definition.',
          feature.id
        ));
      }
      if (!feature.evidence.some((entry) => entry.status === 'passed')) {
        findings.push(finding(
          'done-without-passing-evidence',
          'A done feature requires at least one passing evidence observation.',
          feature.id
        ));
      }
    }
    if (feature.status === 'blocked'
      && !feature.evidence.some((entry) => entry.status === 'blocked')) {
      findings.push(finding(
        'blocked-without-blocker',
        'A blocked feature requires a blocked evidence observation.',
        feature.id
      ));
    }
  }

  if (![...counts.values()].some((count) => count > 1)) {
    findings.push(...findDependencyCycles(usableFeatures, byId));
  }

  if (document.mode === 'serial') {
    const unfinished = usableFeatures.filter((feature) => (
      UNFINISHED_STATUSES.has(feature.status)
    ));
    const active = usableFeatures.filter((feature) => (
      ACTIVE_STATUSES.has(feature.status)
    ));
    if (unfinished.length > 0 && active.length !== 1) {
      findings.push(finding(
        'serial-active-count',
        `Serial mode requires exactly one next or in-progress feature; found ${active.length}.`
      ));
    }
  }

  const sorted = sortFindings(findings);
  return {
    valid: sorted.length === 0,
    canonical: sorted.length === 0
      && document.schemaVersion === FEATURE_STATE_SCHEMA_VERSION,
    findings: sorted
  };
}

function migrationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function migrateFeatureState(document, {branch} = {}) {
  const validation = validateFeatureState(document);
  if (!validation.valid) {
    throw migrationError(
      'INVALID_FEATURE_STATE',
      'Feature state must be valid before migration.'
    );
  }
  if (document.schemaVersion === FEATURE_STATE_SCHEMA_VERSION) {
    return structuredClone(document);
  }
  const hasUnfinished = document.features.some(
    (feature) => feature.status !== 'done'
  );
  if (hasUnfinished && !isValidBranch(branch)) {
    throw migrationError(
      branch === undefined
        ? 'MISSING_MIGRATION_BRANCH'
        : 'INVALID_MIGRATION_BRANCH',
      'A valid Git branch is required to migrate unfinished feature state.'
    );
  }
  return {
    ...structuredClone(document),
    schemaVersion: FEATURE_STATE_SCHEMA_VERSION,
    features: document.features.map((feature) => ({
      ...structuredClone(feature),
      branch: feature.status === 'done' ? null : branch
    }))
  };
}
