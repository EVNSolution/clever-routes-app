export type ReleaseEvidenceVerificationResult = {
  ok: boolean;
  failures: string[];
  warnings: string[];
};

type MarkdownRow = {
  cells: string[];
  source: string;
};

const PENDING_PATTERN = /\bpending\b/i;
const SENSITIVE_OR_BINARY_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: 'bearer token', pattern: /\bBearer\s+[-._~+/=A-Za-z0-9]+/i },
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'literal real token placeholder', pattern: /\breal[-_ ]access[-_ ]token\b/i },
  { label: 'serialized token field', pattern: /\b(access|refresh|id)[-_ ]?token\s*[:=]\s*[-._~+/=A-Za-z0-9]+/i },
  { label: 'mobile binary artifact', pattern: /\.(apk|apks|aab|ipa)(\b|\s|$)/i },
  { label: 'mobile signing artifact', pattern: /\.(keystore|jks|p8|p12|mobileprovision|cer|pem)(\b|\s|$)/i }
];

const COMPLETED_STATUS_VALUES = new Set(['approved', 'complete', 'pass']);
const PASS_STATUS_VALUES = new Set(['pass']);

export function verifyReleaseEvidenceManifest(markdown: string): ReleaseEvidenceVerificationResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  if (markdown.trim() === '') {
    failures.push('release evidence manifest is empty.');
    return { ok: false, failures, warnings };
  }

  if (PENDING_PATTERN.test(markdown)) {
    failures.push('pending placeholder remains in manifest.');
  }

  const matchedSensitivePattern = SENSITIVE_OR_BINARY_PATTERNS.find(({ pattern }) => pattern.test(markdown));
  if (matchedSensitivePattern !== undefined) {
    failures.push(`sensitive or binary artifact pattern found: ${matchedSensitivePattern.label}.`);
  }

  verifyRequiredIdentityFields(markdown, failures);
  verifyBuildEvidence(markdown, failures);
  verifyEnvironmentEvidence(markdown, failures);
  verifyDeviceMatrix(markdown, failures);
  verifyPhysicalDeviceSmokeEvidence(markdown, failures);
  verifyStoreAndPrivacyEvidence(markdown, failures);
  verifyCompletionDecision(markdown, failures);

  return {
    ok: failures.length === 0,
    failures,
    warnings
  };
}

function verifyRequiredIdentityFields(markdown: string, failures: string[]): void {
  const rows = getTableRows(getSection(markdown, 'Release candidate identity'));
  const requiredFields = [
    'Source commit SHA',
    'GitHub PR / merge reference',
    'App version',
    'iOS build number',
    'Android version code',
    'EAS profile',
    'Distribution path',
    'Evidence owner',
    'Evidence storage location',
    'Synthetic data only?'
  ];

  if (rows.length === 0) {
    failures.push('release candidate identity table is missing.');
    return;
  }

  for (const field of requiredFields) {
    const row = findFieldRow(rows, field);
    if (row === undefined || isBlankOrPlaceholder(row.cells[1])) {
      failures.push(`release candidate identity field "${field}" must be filled.`);
    }
  }
}

function verifyBuildEvidence(markdown: string, failures: string[]): void {
  const rows = getDataRows(getSection(markdown, 'Build evidence'));

  if (rows.length === 0) {
    failures.push('build evidence table is missing.');
    return;
  }

  for (const platform of ['iOS', 'Android']) {
    const row = rows.find((candidate) => normalized(candidate.cells[0]) === normalized(platform));
    if (row === undefined) {
      failures.push(`build evidence row for ${platform} is missing.`);
      continue;
    }

    const [, buildUrl, installMethod, artifactReference, notes] = row.cells;
    if ([buildUrl, installMethod, artifactReference, notes].some(isBlankOrPlaceholder)) {
      failures.push(`build evidence row for ${platform} must include EAS build URL/reference, install method, artifact reference, and signing notes.`);
    }
  }
}

function verifyEnvironmentEvidence(markdown: string, failures: string[]): void {
  const rows = getTableRows(getSection(markdown, 'Environment evidence'));
  const requiredFields = [
    'Delivery server environment',
    'EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL source',
    'Driver route fixture reference',
    'Shop/company fixture reference',
    'Proof-media storage backend',
    'Proof-media scanner deployment evidence',
    'Proof-media cleanup scheduler evidence'
  ];

  if (rows.length === 0) {
    failures.push('environment evidence table is missing.');
    return;
  }

  for (const field of requiredFields) {
    const row = findFieldRow(rows, field);
    if (row === undefined || isBlankOrPlaceholder(row.cells[1])) {
      failures.push(`environment evidence field "${field}" must be filled.`);
    }
  }
}

function verifyDeviceMatrix(markdown: string, failures: string[]): void {
  const rows = getDataRows(getSection(markdown, 'Device matrix'));

  if (rows.length === 0) {
    failures.push('device matrix table is missing.');
    return;
  }

  for (const platform of ['iOS', 'Android']) {
    const row = rows.find((candidate) => normalized(candidate.cells[0]) === normalized(platform));
    if (row === undefined) {
      failures.push(`device matrix row for ${platform} is missing.`);
      continue;
    }

    const [rowPlatform, deviceModel, osVersion, localeTimezone, networkMode, tester, dateTime] = row.cells;
    if ([rowPlatform, deviceModel, osVersion, localeTimezone, networkMode, tester, dateTime].some(isBlankOrPlaceholder)) {
      failures.push(`device matrix row for ${platform} must have device, OS, locale/timezone, network, tester, and timestamp evidence.`);
    }
  }
}

function verifyPhysicalDeviceSmokeEvidence(markdown: string, failures: string[]): void {
  const rows = getDataRows(getSection(markdown, 'Physical-device smoke evidence'));

  if (rows.length === 0) {
    failures.push('physical-device smoke evidence table is missing.');
    return;
  }

  for (const row of rows) {
    const [area, iphoneResult, iphoneEvidence, androidResult, androidEvidence] = row.cells;
    if (
      isBlankOrPlaceholder(area) ||
      !PASS_STATUS_VALUES.has(normalized(iphoneResult)) ||
      !PASS_STATUS_VALUES.has(normalized(androidResult)) ||
      isBlankOrPlaceholder(iphoneEvidence) ||
      isBlankOrPlaceholder(androidEvidence)
    ) {
      failures.push(`physical-device smoke row "${area || row.source}" must have pass result and evidence references for iPhone and Android.`);
    }
  }
}

function verifyStoreAndPrivacyEvidence(markdown: string, failures: string[]): void {
  const rows = getDataRows(getSection(markdown, 'Store and privacy review evidence'));

  if (rows.length === 0) {
    failures.push('store/privacy review evidence table is missing.');
    return;
  }

  for (const row of rows) {
    const [area, status, evidenceReference, approver] = row.cells;
    if (
      isBlankOrPlaceholder(area) ||
      !COMPLETED_STATUS_VALUES.has(normalized(status)) ||
      isBlankOrPlaceholder(evidenceReference) ||
      isBlankOrPlaceholder(approver)
    ) {
      failures.push(`store/privacy row "${area || row.source}" must be approved or complete with evidence reference and owner/legal approver.`);
    }
  }
}

function verifyCompletionDecision(markdown: string, failures: string[]): void {
  const rows = getDataRows(getSection(markdown, 'Completion decision'));

  if (rows.length === 0) {
    failures.push('completion decision table is missing.');
  }

  for (const row of rows) {
    const [gate, status] = row.cells;
    if (isBlankOrPlaceholder(gate) || !COMPLETED_STATUS_VALUES.has(normalized(status))) {
      failures.push(`completion decision gate "${gate || row.source}" must have pass, approved, or complete status.`);
    }
  }

  const releaseDecision = getScalarValue(markdown, 'Release candidate decision');
  if (normalized(releaseDecision) !== 'approved') {
    failures.push('release candidate decision must be approved.');
  }

  for (const label of ['Decision owner', 'Decision timestamp']) {
    const value = getScalarValue(markdown, label);
    if (isBlankOrPlaceholder(value)) {
      failures.push(`${label.toLowerCase()} must be filled.`);
    }
  }
}

function getSection(markdown: string, heading: string): string {
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'im');
  const match = headingPattern.exec(markdown);
  if (match === null) {
    return '';
  }

  const startIndex = match.index + match[0].length;
  const nextHeading = /^##\s+/im.exec(markdown.slice(startIndex));
  if (nextHeading === null) {
    return markdown.slice(startIndex);
  }

  return markdown.slice(startIndex, startIndex + nextHeading.index);
}

function getTableRows(section: string): MarkdownRow[] {
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'))
    .filter((line) => !/^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line))
    .map((line) => ({ cells: splitTableRow(line), source: line }))
    .filter((row) => row.cells.length > 0);
}

function getDataRows(section: string): MarkdownRow[] {
  return getTableRows(section).filter((row) => !isHeaderRow(row));
}

function splitTableRow(line: string): string[] {
  return line
    .slice(1, line.endsWith('|') ? -1 : undefined)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').replace(/`/g, '').trim());
}

function isHeaderRow(row: MarkdownRow): boolean {
  const firstCell = normalized(row.cells[0]);
  return ['field', 'platform', 'area', 'gate'].includes(firstCell);
}

function findFieldRow(rows: MarkdownRow[], field: string): MarkdownRow | undefined {
  const expected = normalized(field);
  return rows.find((row) => normalized(row.cells[0]) === expected);
}

function getScalarValue(markdown: string, label: string): string | undefined {
  const pattern = new RegExp(`^${escapeRegExp(label)}:\\s*(.*)$`, 'im');
  return pattern.exec(markdown)?.[1]?.replace(/`/g, '').trim();
}

function isBlankOrPlaceholder(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }

  const cleanValue = value.replace(/`/g, '').trim();
  return cleanValue === '' || /^pending(\s*\/\s*n\/a)?$/i.test(cleanValue) || /^n\/a\s*\/\s*pending$/i.test(cleanValue);
}

function normalized(value: string | undefined): string {
  return value?.replace(/`/g, '').trim().toLowerCase() ?? '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
