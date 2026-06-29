import {
  ASSESSMENT_SCHEMA_VERSION,
  MATURITY_LABELS
} from './constants.mjs';
import { discoverHarness } from './discovery.mjs';

const LIMITATIONS = Object.freeze([
  'This assessment measures structural Readiness, not task Effectiveness.',
  'Declared commands are inspected but never executed.'
]);

const missingCodes = Object.freeze({
  'instructions.file': 'missing-instructions',
  'context.file': 'missing-context',
  'tools.file': 'missing-tools',
  'environment.file': 'missing-environment',
  'initialize.executable': 'missing-initialize',
  'state.feature': 'missing-feature-state',
  'state.progress': 'missing-progress',
  'verify.command': 'missing-verification',
  'verify.executable': 'missing-verification',
  'verify.package-script': 'missing-verification',
  'feedback.ci': 'missing-feedback'
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSignals(rule) {
  return [...new Set([
    ...rule.presentAny,
    ...rule.operationalAll.flat()
  ])];
}

function sortRecords(records) {
  return records.sort((left, right) => {
    const leftKey = `${left.ruleId}\0${left.source ?? ''}\0${left.code ?? ''}\0${left.detail ?? left.message}`;
    const rightKey = `${right.ruleId}\0${right.source ?? ''}\0${right.code ?? ''}\0${right.detail ?? right.message}`;
    return compareText(leftKey, rightKey);
  });
}

function missingGap(group) {
  const signal = group[0];
  return {
    ruleId: signal,
    source: signal,
    code: missingCodes[signal] ?? 'missing-operational-signal',
    detail: `Operational evidence is missing for: ${group.join(' or ')}.`
  };
}

function assessRule(rule, discovery) {
  const signalIds = uniqueSignals(rule);
  const signalResults = signalIds.map((id) => discovery.signals[id]);
  const evidence = signalResults.flatMap((result) => result.evidence);
  const gaps = signalResults.flatMap((result) => result.gaps);
  const unknowns = [
    ...discovery.subsystemUnknowns[rule.subsystem],
    ...signalResults.flatMap((result) => result.unknowns)
  ];
  const present = rule.presentAny.some((id) => discovery.signals[id].present);
  const operational = rule.operationalAll.every((group) => (
    group.some((id) => discovery.signals[id].operational)
  ));

  for (const group of rule.operationalAll) {
    if (!group.some((id) => discovery.signals[id].operational)
      && !group.some((id) => discovery.signals[id].present)) {
      gaps.push(missingGap(group));
    }
  }

  let level;
  let label;
  if (operational) {
    level = 2;
    label = MATURITY_LABELS[level];
  } else if (present) {
    level = 1;
    label = MATURITY_LABELS[level];
  } else if (unknowns.length > 0) {
    level = null;
    label = 'Unknown';
  } else {
    level = 0;
    label = MATURITY_LABELS[level];
  }

  return {
    level,
    label,
    evidence: sortRecords(evidence),
    gaps: sortRecords(gaps),
    unknowns: sortRecords(unknowns)
  };
}

function unmetRecommendation(rule, discovery) {
  return rule.operationalAll
    .map((group, index) => (
      group.some((id) => discovery.signals[id].operational)
        ? null
        : rule.recommendations[index]
    ))
    .filter(Boolean)
    .join(' ');
}

function recommendationsFor(rules, subsystems, discovery) {
  const recommendations = [];
  for (const rule of rules.rules) {
    const assessment = subsystems[rule.subsystem];
    if (assessment.level === 2) {
      continue;
    }
    recommendations.push({
      ruleId: rule.id,
      subsystem: rule.subsystem,
      priority: assessment.level === 1 ? 2 : 1,
      message: unmetRecommendation(rule, discovery)
    });
  }
  return recommendations.sort((left, right) => (
    left.priority - right.priority
    || rules.subsystemOrder.indexOf(left.subsystem)
      - rules.subsystemOrder.indexOf(right.subsystem)
    || compareText(left.ruleId, right.ruleId)
  ));
}

function candidateBottlenecks(subsystems, subsystemOrder) {
  const knownLevels = subsystemOrder
    .map((name) => subsystems[name].level)
    .filter((level) => level !== null);
  if (knownLevels.length === 0) {
    return [];
  }
  const minimum = Math.min(...knownLevels);
  if (minimum >= 2) {
    return [];
  }
  return subsystemOrder.filter((name) => subsystems[name].level === minimum);
}

export async function inspectHarness(options) {
  if (options === null || typeof options !== 'object'
    || typeof options.root !== 'string' || options.root.length === 0) {
    throw new TypeError('inspectHarness requires a non-empty root path');
  }

  const discovery = await discoverHarness(options);
  const subsystems = {};
  for (const rule of discovery.rules.rules) {
    subsystems[rule.subsystem] = assessRule(rule, discovery);
  }

  return {
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    target: '.',
    mode: 'readiness',
    subsystems,
    candidateBottlenecks: candidateBottlenecks(
      subsystems,
      discovery.rules.subsystemOrder
    ),
    recommendations: recommendationsFor(
      discovery.rules,
      subsystems,
      discovery
    ),
    unknowns: discovery.globalUnknowns,
    limitations: [...LIMITATIONS],
    effectiveness: {
      status: 'not-assessed',
      reason: 'Representative task evidence was not provided.'
    }
  };
}
