export function renderPlanText(plan) {
  const lines = [
    'Harness Archiver Plan',
    `Stage ID: ${plan.stage?.stageId ?? 'blocked'}`,
    `Eligible: ${plan.eligible ? 'yes' : 'no'}`,
    `Plan ID: ${plan.planId}`,
    '',
    'Actions:'
  ];
  for (const action of plan.actions) {
    lines.push(`- ${action.operation.toUpperCase()} ${action.path}`);
  }
  if (plan.findings.length > 0) {
    lines.push('', 'Findings:');
    for (const item of plan.findings) {
      lines.push(`- ${item.code}: ${item.detail}`);
    }
  }
  return lines.join('\n');
}

export function renderApplyText(result) {
  return [
    'Harness Archiver Apply',
    `Stage ID: ${result.stageId}`,
    `Status: ${result.status}`,
    `Baseline: ${result.stageId}`
  ].join('\n');
}
