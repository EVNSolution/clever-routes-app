import type { NativeReleasePreflightInput, NativeReleasePreflightResult } from '../preflight/nativeReleasePreflight';

export type ReleaseEvidenceSeedInput = {
  appConfig: NativeReleasePreflightInput['appConfig'];
  easConfig: NativeReleasePreflightInput['easConfig'];
  preflight: NativeReleasePreflightResult;
  sourceCommitSha: string;
  sourceRef: string;
  trackingIssues: {
    nativeBuildEvidence: string;
    physicalDeviceSmoke: string;
    proofMediaProduction: string;
  };
};

export function buildReleaseEvidenceSeed(input: ReleaseEvidenceSeedInput): string {
  const expo = input.appConfig.expo ?? {};
  const lines = [
    '# Clever Driver release evidence seed',
    '',
    'Copy this output into the approved external release evidence store before filling device, build, and owner approval results. Do not commit completed evidence manifests or binary artifacts.',
    '',
    '## Source revision',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Source commit SHA | \`${input.sourceCommitSha}\` |`,
    `| Source ref | \`${input.sourceRef}\` |`,
    `| App version | \`${formatValue(expo.version)}\` |`,
    `| iOS build number | \`${formatValue(expo.ios?.buildNumber)}\` |`,
    `| Android version code | \`${formatValue(expo.android?.versionCode)}\` |`,
    '',
    '## EAS build commands to run after owner-controlled setup',
    '',
    '| Candidate | Command | Current profile evidence |',
    '| --- | --- | --- |',
    `| Android preview | \`npx eas-cli build --platform android --profile preview\` | ${profileSummary(input.easConfig.build?.preview)} |`,
    `| iOS preview | \`npx eas-cli build --platform ios --profile preview\` | ${profileSummary(input.easConfig.build?.preview)} |`,
    `| Production all | \`npx eas-cli build --platform all --profile production\` | ${profileSummary(input.easConfig.build?.production)} |`,
    '',
    '## Source-controlled preflight result',
    '',
    `Overall result: **${input.preflight.ok ? 'pass' : 'fail'}**`,
    '',
    '| Check | Result | Message |',
    '| --- | --- | --- |',
    ...input.preflight.checks.map((check) => `| \`${check.id}\` | ${check.ok ? 'pass' : 'fail'} | ${escapeTableCell(check.message)} |`),
    '',
    '## External gates still requiring owner evidence',
    '',
    ...input.preflight.externalBlockers.map((blocker) => `- ${blocker}`),
    '',
    '## Tracking issues',
    '',
    '| Gate | Issue | Status to fill externally |',
    '| --- | --- | --- |',
    `| Physical iOS/Android smoke evidence | ${input.trackingIssues.physicalDeviceSmoke} | pending external evidence |`,
    `| Native builds, signing, store/privacy approvals, license decision | ${input.trackingIssues.nativeBuildEvidence} | pending external evidence |`,
    `| Production proof-media object storage, scanner, signed access, cleanup evidence | ${input.trackingIssues.proofMediaProduction} | pending external evidence |`,
    '',
    '## Local command evidence to rerun from this source revision',
    '',
    '- `npm run check:workspace`',
    '- `npm run lint`',
    '- `npm run check:native-release`',
    '- `npm run build`',
    '- `npm audit --audit-level=moderate`',
    '- `npx expo install --check`',
    '- `git diff --check`',
    ''
  ];

  return lines.join('\n');
}

function profileSummary(profile: Record<string, unknown> | undefined): string {
  if (profile === undefined) {
    return 'profile missing';
  }

  const parts = [
    profile.distribution === undefined ? undefined : `distribution=${String(profile.distribution)}`,
    profile.environment === undefined ? undefined : `environment=${String(profile.environment)}`,
    profile.autoIncrement === undefined ? undefined : `autoIncrement=${String(profile.autoIncrement)}`
  ].filter((part): part is string => part !== undefined);

  return parts.length === 0 ? 'profile present' : parts.join(', ');
}

function formatValue(value: unknown): string {
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return 'pending';
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}
