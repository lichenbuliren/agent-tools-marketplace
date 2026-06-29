export const ASSESSMENT_SCHEMA_VERSION = '1.0.0';
export const MANIFEST_SCHEMA_VERSION = '1.0.0';
export const DEFAULT_MANIFEST_PATH = '.harness/manifest.json';

export const SUBSYSTEM_ORDER = Object.freeze([
  'instructions',
  'tools',
  'environment',
  'state',
  'feedback'
]);

export const MATURITY_LABELS = Object.freeze({
  0: 'Missing',
  1: 'Present',
  2: 'Operational',
  3: 'Evidenced'
});

export const DEFAULT_LIMITS = Object.freeze({
  maxBytes: 262_144,
  maxDeclaredPaths: 128
});

export const ARTIFACT_KEYS = Object.freeze([
  'instructions',
  'context',
  'featureState',
  'progress',
  'environment',
  'tools',
  'readinessEvidence'
]);

export const COMMAND_KEYS = Object.freeze([
  'initialize',
  'setup',
  'verify'
]);
