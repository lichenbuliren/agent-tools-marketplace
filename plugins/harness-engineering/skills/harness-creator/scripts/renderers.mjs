import {
  SUBSYSTEM_ORDER
} from '../../../runtime/harness-core/src/constants.mjs';

function titleCase(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function profileLines(assessment) {
  return SUBSYSTEM_ORDER.map((subsystem) => {
    const item = assessment.subsystems[subsystem];
    const maturity = item.level === null
      ? item.label
      : `${item.level} ${item.label}`;
    return `${titleCase(subsystem)}: ${maturity}`;
  });
}

function bottleneckLines(assessment) {
  return assessment.candidateBottlenecks.length > 0
    ? assessment.candidateBottlenecks.map((item) => `- ${item}`)
    : ['- None'];
}

export function renderPlanText(plan) {
  const lines = [
    'Harness Creator Plan',
    `Plan ID: ${plan.planId}`,
    '',
    'Before Readiness',
    ...profileLines(plan.assessmentBefore),
    '',
    'Candidate bottlenecks',
    ...bottleneckLines(plan.assessmentBefore),
    '',
    'Actions'
  ];

  for (const action of plan.actions) {
    lines.push(
      `${action.operation.toUpperCase()} ${action.path} [${action.capability}]`,
      `Reason: ${action.reason}`
    );
    if (action.content !== undefined) {
      lines.push('Intended content:', action.content.trimEnd());
    }
    lines.push('');
  }

  const blocked = plan.actions.filter(
    (action) => action.operation === 'block'
  );
  lines.push(
    'Risks',
    '- Apply only this exact planId; relevant target changes make it stale.',
    '- Existing project files are preserved unless a validated semantic merge is shown.',
    ...(blocked.length > 0
      ? [`- ${blocked.length} blocked action(s) must be resolved before apply.`]
      : ['- No blocked actions were found.']),
    '',
    `Effectiveness: ${plan.assessmentBefore.effectiveness.status}`,
    `Reason: ${plan.assessmentBefore.effectiveness.reason}`
  );

  return lines.join('\n');
}

export function renderApplyText(result) {
  const lines = [
    'Harness Creator Apply',
    `Plan ID: ${result.plan.planId}`,
    '',
    'Before Readiness',
    ...profileLines(result.plan.assessmentBefore),
    '',
    'Results',
    ...result.results.map(
      (item) => `${item.status.toUpperCase()} ${item.path}: ${item.reason}`
    ),
    '',
    'After Readiness',
    ...profileLines(result.assessmentAfter),
    '',
    'Candidate bottlenecks',
    ...bottleneckLines(result.assessmentAfter),
    '',
    `Effectiveness: ${result.assessmentAfter.effectiveness.status}`,
    `Reason: ${result.assessmentAfter.effectiveness.reason}`
  ];

  return lines.join('\n');
}
