import {
  SUBSYSTEM_ORDER
} from '../../../runtime/harness-core/src/constants.mjs';

function titleCase(value) {
  return String(value).replace(
    /(^|[-_\s])([a-z])/g,
    (_, boundary, letter) => `${boundary === '-' || boundary === '_' ? ' ' : boundary}${letter.toUpperCase()}`
  );
}

function profileRows(assessment) {
  return SUBSYSTEM_ORDER.map((subsystem) => {
    const finding = assessment.subsystems[subsystem];
    return {
      subsystem,
      name: titleCase(subsystem),
      level: finding.level,
      label: finding.label,
      finding
    };
  });
}

function findingRows(assessment) {
  return profileRows(assessment).flatMap(({name, finding}) => [
    ...finding.evidence.map((item) => ({...item, kind: 'Evidence', subsystem: name})),
    ...finding.gaps.map((item) => ({...item, kind: 'Gap', subsystem: name})),
    ...finding.unknowns.map((item) => ({...item, kind: 'Unknown', subsystem: name}))
  ]);
}

function allUnknowns(assessment) {
  return [
    ...assessment.unknowns.map((item) => ({...item, subsystem: 'General'})),
    ...profileRows(assessment).flatMap(({name, finding}) => (
      finding.unknowns.map((item) => ({...item, subsystem: name}))
    ))
  ];
}

function levelText(row) {
  return row.level === null ? row.label : `${row.level} ${row.label}`;
}

function detailText(item) {
  return `${item.ruleId} [${item.source}] ${item.detail}`;
}

function markdownText(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderText(assessment) {
  const lines = [
    'Harness Doctor',
    `Mode: ${assessment.mode}`,
    `Schema: ${assessment.schemaVersion}`,
    '',
    'Readiness profile',
    ...profileRows(assessment).map((row) => `${row.name}: ${levelText(row)}`),
    '',
    'Candidate bottlenecks',
    ...(assessment.candidateBottlenecks.length > 0
      ? assessment.candidateBottlenecks.map((item) => `- ${item}`)
      : ['- None']),
    '',
    'Recommendations',
    ...(assessment.recommendations.length > 0
      ? assessment.recommendations.map(
        (item) => `${item.priority}. [${item.ruleId}] ${item.message}`
      )
      : ['- None']),
    '',
    'Findings',
    ...(findingRows(assessment).length > 0
      ? findingRows(assessment).map(
        (item) => `- ${item.subsystem} ${item.kind}: ${detailText(item)}`
      )
      : ['- None']),
    '',
    'Unknowns',
    ...(allUnknowns(assessment).length > 0
      ? allUnknowns(assessment).map((item) => `- ${detailText(item)}`)
      : ['- None']),
    '',
    ...(assessment.lifecycle ? [
      'Lifecycle',
      `Archive eligible: ${assessment.lifecycle.archiveEligible ? 'yes' : 'no'}`,
      `Baseline: ${assessment.lifecycle.baseline.status}${assessment.lifecycle.baseline.stageId ? ` (${assessment.lifecycle.baseline.stageId})` : ''}`,
      `Branch ownership: ${assessment.lifecycle.branchOwnership.status}`,
      ...assessment.lifecycle.recommendations.map((item) => `- ${item}`),
      ''
    ] : []),
    'Effectiveness',
    `Status: ${assessment.effectiveness.status}`,
    `Reason: ${assessment.effectiveness.reason}`,
    '',
    'Limitations',
    ...assessment.limitations.map((item) => `- ${item}`)
  ];

  return lines.join('\n');
}

export function renderMarkdown(assessment) {
  const rows = profileRows(assessment);
  const findings = findingRows(assessment);
  const unknowns = allUnknowns(assessment);
  const lines = [
    '# Harness Doctor',
    '',
    `- Mode: \`${markdownText(assessment.mode)}\``,
    `- Schema: \`${markdownText(assessment.schemaVersion)}\``,
    '',
    '## Readiness Profile',
    '',
    '| Subsystem | Level | Label |',
    '|---|---:|---|',
    ...rows.map((row) => (
      `| ${row.name} | ${row.level === null ? '-' : row.level} | ${markdownText(row.label)} |`
    )),
    '',
    '## Candidate Bottlenecks',
    '',
    ...(assessment.candidateBottlenecks.length > 0
      ? assessment.candidateBottlenecks.map((item) => `- ${markdownText(item)}`)
      : ['- None']),
    '',
    '## Recommendations',
    '',
    ...(assessment.recommendations.length > 0
      ? assessment.recommendations.map(
        (item) => `${item.priority}. **${markdownText(item.ruleId)}**: ${markdownText(item.message)}`
      )
      : ['- None']),
    '',
    '## Findings',
    '',
    ...(findings.length > 0
      ? findings.map(
        (item) => `- **${item.subsystem} ${item.kind}**: ${markdownText(detailText(item))}`
      )
      : ['- None']),
    '',
    '## Unknowns',
    '',
    ...(unknowns.length > 0
      ? unknowns.map((item) => `- ${markdownText(detailText(item))}`)
      : ['- None']),
    '',
    ...(assessment.lifecycle ? [
      '## Lifecycle',
      '',
      `- Archive eligible: \`${assessment.lifecycle.archiveEligible ? 'yes' : 'no'}\``,
      `- Baseline: \`${markdownText(assessment.lifecycle.baseline.status)}\``,
      `- Branch ownership: \`${markdownText(assessment.lifecycle.branchOwnership.status)}\``,
      ...assessment.lifecycle.recommendations.map((item) => `- ${markdownText(item)}`),
      ''
    ] : []),
    '## Effectiveness',
    '',
    `- Status: \`${markdownText(assessment.effectiveness.status)}\``,
    `- Reason: ${markdownText(assessment.effectiveness.reason)}`,
    '',
    '## Limitations',
    '',
    ...assessment.limitations.map((item) => `- ${markdownText(item)}`)
  ];

  return lines.join('\n');
}

function htmlList(items, renderItem) {
  if (items.length === 0) {
    return '<p>None</p>';
  }
  return `<ul>${items.map((item) => `<li>${renderItem(item)}</li>`).join('')}</ul>`;
}

export function renderHtml(assessment) {
  const rows = profileRows(assessment);
  const findings = findingRows(assessment);
  const unknowns = allUnknowns(assessment);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harness Doctor</title>
<style>
:root{color-scheme:light;--ink:#18211b;--paper:#f3efe4;--line:#b5ad99;--accent:#a53f2b}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 Georgia,serif}main{width:min(920px,calc(100% - 2rem));margin:2rem auto 4rem}h1,h2{line-height:1.1}h1{font-size:clamp(2.4rem,8vw,5rem);margin-bottom:.25rem}h2{border-top:2px solid var(--ink);padding-top:.65rem;margin-top:2rem}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid var(--line);padding:.6rem}.meta{color:var(--accent)}code{font-family:ui-monospace,monospace}li+li{margin-top:.35rem}
</style>
</head>
<body>
<main>
<header><h1>Harness Doctor</h1><p class="meta">Mode: ${escapeHtml(assessment.mode)} · Schema: ${escapeHtml(assessment.schemaVersion)}</p></header>
<section><h2>Readiness Profile</h2><table><thead><tr><th>Subsystem</th><th>Level</th><th>Label</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.level === null ? '-' : escapeHtml(row.level)}</td><td>${escapeHtml(row.label)}</td></tr>`).join('')}</tbody></table></section>
<section><h2>Candidate Bottlenecks</h2>${htmlList(assessment.candidateBottlenecks, escapeHtml)}</section>
<section><h2>Recommendations</h2>${htmlList(assessment.recommendations, (item) => `<strong>${escapeHtml(item.priority)}. ${escapeHtml(item.ruleId)}</strong>: ${escapeHtml(item.message)}`)}</section>
<section><h2>Findings</h2>${htmlList(findings, (item) => `<strong>${escapeHtml(item.subsystem)} ${escapeHtml(item.kind)}</strong>: ${escapeHtml(detailText(item))}`)}</section>
<section><h2>Unknowns</h2>${htmlList(unknowns, (item) => escapeHtml(detailText(item)))}</section>
${assessment.lifecycle ? `<section><h2>Lifecycle</h2><p><strong>Archive eligible:</strong> ${assessment.lifecycle.archiveEligible ? 'yes' : 'no'}</p><p><strong>Baseline:</strong> ${escapeHtml(assessment.lifecycle.baseline.status)}</p><p><strong>Branch ownership:</strong> ${escapeHtml(assessment.lifecycle.branchOwnership.status)}</p>${htmlList(assessment.lifecycle.recommendations, escapeHtml)}</section>` : ''}
<section><h2>Effectiveness</h2><p><strong>Status:</strong> ${escapeHtml(assessment.effectiveness.status)}</p><p><strong>Reason:</strong> ${escapeHtml(assessment.effectiveness.reason)}</p></section>
<section><h2>Limitations</h2>${htmlList(assessment.limitations, escapeHtml)}</section>
</main>
</body>
</html>`;
}
