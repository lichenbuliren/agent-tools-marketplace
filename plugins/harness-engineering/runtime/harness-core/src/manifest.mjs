import {
  ARTIFACT_KEYS,
  COMMAND_KEYS,
  DEFAULT_LIMITS,
  DEFAULT_MANIFEST_PATH,
  MANIFEST_SCHEMA_VERSION
} from './constants.mjs';
import {
  normalizeDeclaredPath,
  readBoundedFile
} from './path-safety.mjs';

function emptyManifest() {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    artifacts: Object.fromEntries(ARTIFACT_KEYS.map((key) => [key, []])),
    commands: Object.fromEntries(COMMAND_KEYS.map((key) => [key, []]))
  };
}

function unknown(source, code, detail) {
  return {
    ruleId: 'manifest.load',
    source,
    code,
    detail
  };
}

function stableUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function validateSection(section, allowedKeys, sectionName, source, unknowns) {
  if (section === undefined) {
    return {};
  }
  if (section === null || typeof section !== 'object' || Array.isArray(section)) {
    unknowns.push(unknown(
      source,
      'invalid-shape',
      `Manifest ${sectionName} must be an object.`
    ));
    return {};
  }

  const result = {};
  for (const [key, value] of Object.entries(section)) {
    if (!allowedKeys.includes(key)) {
      unknowns.push(unknown(
        source,
        'unknown-key',
        `Manifest ${sectionName} key "${key}" is not supported.`
      ));
      continue;
    }
    if (!Array.isArray(value)
      || value.some((item) => typeof item !== 'string' || item.length === 0)) {
      unknowns.push(unknown(
        source,
        'invalid-shape',
        `Manifest ${sectionName}.${key} must be an array of non-empty strings.`
      ));
      continue;
    }
    result[key] = stableUnique(value);
  }
  return result;
}

function sortUnknowns(unknowns) {
  return unknowns.sort((left, right) => (
    `${left.source}\0${left.code}\0${left.detail}`
      .localeCompare(`${right.source}\0${right.code}\0${right.detail}`)
  ));
}

export async function loadManifest(root, options = {}) {
  const {
    manifestPath = DEFAULT_MANIFEST_PATH,
    maxBytes = DEFAULT_LIMITS.maxBytes,
    maxDeclaredPaths = DEFAULT_LIMITS.maxDeclaredPaths
  } = options;
  const normalizedManifestPath = normalizeDeclaredPath(root, manifestPath);
  const manifest = emptyManifest();

  if (!normalizedManifestPath.ok) {
    return {
      manifest,
      manifestPath,
      found: false,
      unknowns: [unknown(
        String(manifestPath),
        normalizedManifestPath.reason,
        'Harness manifest path must stay inside the target repository.'
      )]
    };
  }

  const source = normalizedManifestPath.relativePath;
  const file = await readBoundedFile(root, source, { maxBytes });
  if (!file.ok) {
    if (file.reason === 'missing' && manifestPath === DEFAULT_MANIFEST_PATH) {
      return { manifest, manifestPath: source, found: false, unknowns: [] };
    }
    return {
      manifest,
      manifestPath: source,
      found: false,
      unknowns: [unknown(
        source,
        file.reason,
        `Harness manifest could not be read: ${file.reason}.`
      )]
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    return {
      manifest,
      manifestPath: source,
      found: true,
      unknowns: [unknown(
        source,
        'invalid-json',
        'Harness manifest is not valid JSON.'
      )]
    };
  }

  const unknowns = [];
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      manifest,
      manifestPath: source,
      found: true,
      unknowns: [unknown(
        source,
        'invalid-shape',
        'Harness manifest must be a JSON object.'
      )]
    };
  }
  if (parsed.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    unknowns.push(unknown(
      source,
      'unsupported-schema-version',
      `Harness manifest schemaVersion must be "${MANIFEST_SCHEMA_VERSION}".`
    ));
  }

  const artifacts = validateSection(
    parsed.artifacts,
    ARTIFACT_KEYS,
    'artifacts',
    source,
    unknowns
  );
  const commands = validateSection(
    parsed.commands,
    COMMAND_KEYS,
    'commands',
    source,
    unknowns
  );
  const declaredPathCount = Object.values(artifacts)
    .reduce((total, values) => total + values.length, 0);

  if (declaredPathCount > maxDeclaredPaths) {
    return {
      manifest,
      manifestPath: source,
      found: true,
      unknowns: [unknown(
        source,
        'declaration-limit-exceeded',
        `Harness manifest declares ${declaredPathCount} paths; limit is ${maxDeclaredPaths}.`
      )]
    };
  }

  for (const key of ARTIFACT_KEYS) {
    for (const declaredPath of artifacts[key] ?? []) {
      const normalized = normalizeDeclaredPath(root, declaredPath);
      if (!normalized.ok) {
        unknowns.push({
          ...unknown(
            declaredPath,
            normalized.reason,
            `Declared ${key} path must stay inside the target repository.`
          ),
          ruleId: `manifest.artifacts.${key}`
        });
        continue;
      }
      manifest.artifacts[key].push(normalized.relativePath);
    }
    manifest.artifacts[key] = stableUnique(manifest.artifacts[key]);
  }
  for (const key of COMMAND_KEYS) {
    manifest.commands[key] = stableUnique(commands[key] ?? []);
  }

  return {
    manifest,
    manifestPath: source,
    found: true,
    unknowns: sortUnknowns(unknowns)
  };
}
