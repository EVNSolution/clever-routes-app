import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildDriveDownloadUrl,
  buildSsmPublishCommand,
  buildVersionedApkFileName,
  createAndroidReleasePublicationPlan,
  parseAaptBadging,
  type AndroidApkMetadata,
  type AndroidReleasePublisherInput,
} from './androidReleasePublisher';

const sha256 = 'a'.repeat(64);
const source = {
  branch: 'dev',
  clean: true,
  headSha: 'abc123',
  remoteHeadSha: 'abc123',
};
const ssm = {
  instanceId: 'i-0123456789abcdef0',
  region: 'us-east-1',
};
const apk: AndroidApkMetadata = {
  appName: 'CLEVER Routes',
  packageName: 'com.evnsolution.clever.routes',
  sha256,
  versionCode: 9,
  versionName: '1.1.2',
};

function publishInput(overrides: Partial<AndroidReleasePublisherInput> = {}): AndroidReleasePublisherInput {
  return {
    apk,
    currentRelease: {
      installUrl: 'https://delivery.example.com/routes-app/download',
      latestVersionCode: 8,
      latestVersionName: '1.1.1',
      minimumSupportedVersionCode: 8,
      platform: 'android',
    },
    drive: {
      existingFiles: [],
      folderId: '15Am4CFvcp2szOuuKpGnWgJEB22H96rwZ',
    },
    gcloudAccount: 'dlajiin@gmail.com',
    mode: 'publish',
    publicInstallUrl: 'https://delivery.example.com/routes-app',
    source,
    ssm,
    ...overrides,
  };
}

describe('Android release publisher planning', () => {
  it('reads APK package, version, name, and sha256 from aapt badging output', () => {
    const metadata = parseAaptBadging(
      [
        "package: name='com.evnsolution.clever.routes' versionCode='9' versionName='1.1.2' platformBuildVersionName='16'",
        "application-label:'CLEVER Routes'",
      ].join('\n'),
      sha256,
    );

    assert.deepEqual(metadata, apk);
    assert.equal(buildVersionedApkFileName(metadata), 'com.evnsolution.clever.routes-1.1.2-9.apk');
  });

  it('builds the reviewed server publisher command for SSM execution', () => {
    assert.deepEqual(buildSsmPublishCommand({
      apkSha256: sha256,
      downloadUrl: 'https://drive.google.com/uc?export=download&id=file-9',
      instanceId: ssm.instanceId,
      minimumVersionCode: 8,
      region: ssm.region,
      versionCode: 9,
      versionName: '1.1.2',
    }), [
      'aws',
      'ssm',
      'send-command',
      '--region',
      'us-east-1',
      '--instance-ids',
      'i-0123456789abcdef0',
      '--document-name',
      'AWS-RunShellScript',
      '--parameters',
      '{"commands":["cd /srv/clever-route-server && docker compose --env-file .deploy/current-image.env -f infra/compose/docker-compose.prod.yml exec -T clever-route-api node dist/scripts/publish-routes-app-release.js --version-code 9 --version-name \'1.1.2\' --minimum-version-code 8 --apk-sha256 \'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\' --download-url \'https://drive.google.com/uc?export=download&id=file-9\'"]}',
      '--query',
      'Command.CommandId',
      '--output',
      'text',
    ]);
  });

  it('plans a new immutable Drive APK upload and server publish after release gates pass', () => {
    const plan = createAndroidReleasePublicationPlan(publishInput());

    assert.equal(plan.mode, 'publish');
    assert.equal(plan.driveFileName, 'com.evnsolution.clever.routes-1.1.2-9.apk');
    assert.equal(plan.needsDriveUpload, true);
    assert.equal(plan.downloadUrl, buildDriveDownloadUrl('NEW_FILE_ID_AFTER_UPLOAD'));
    assert.deepEqual(plan.validations, [
      'source dev@abc123 matches origin/dev',
      'gcloud account dlajiin@gmail.com approved',
      'Drive folder 15Am4CFvcp2szOuuKpGnWgJEB22H96rwZ approved',
    ]);
    assert.match(plan.ssmCommand.join(' '), /publish-routes-app-release\.js --version-code 9/u);
  });

  it('blocks unofficial source, dirty source, account drift, package drift, rollbacks, and conflicting retries', () => {
    const cases: [string, Partial<AndroidReleasePublisherInput>][] = [
      ['official release source', { source: { ...source, branch: 'feature' } }],
      ['worktree must be clean', { source: { ...source, clean: false } }],
      ['does not match origin', { source: { ...source, remoteHeadSha: 'def456' } }],
      ['gcloud account must be dlajiin@gmail.com', { gcloudAccount: 'someone@example.com' }],
      ['Drive folder must be 15Am4CFvcp2szOuuKpGnWgJEB22H96rwZ', { drive: { existingFiles: [], folderId: 'wrong' } }],
      ['APK package must be com.evnsolution.clever.routes', { apk: { ...apk, packageName: 'com.example.app' } }],
      ['versionCode rollback blocked', { currentRelease: { installUrl: 'x', latestVersionCode: 9, latestVersionName: '1.1.2', minimumSupportedVersionCode: 8, platform: 'android' } }],
      ['refusing conflicting retry', { drive: { existingFiles: [{ id: 'file-9', name: 'com.evnsolution.clever.routes-1.1.2-9.apk' }], folderId: '15Am4CFvcp2szOuuKpGnWgJEB22H96rwZ' } }],
    ];

    for (const [message, overrides] of cases) {
      assert.throws(() => createAndroidReleasePublicationPlan(publishInput(overrides)), new RegExp(message, 'u'));
    }
  });

  it('reuses a same-name same-checksum Drive orphan instead of blocking recovery', () => {
    const plan = createAndroidReleasePublicationPlan(publishInput({
      drive: {
        existingFiles: [{
          id: 'orphan-file-9',
          name: 'com.evnsolution.clever.routes-1.1.2-9.apk',
          sha256,
        }],
        folderId: '15Am4CFvcp2szOuuKpGnWgJEB22H96rwZ',
      },
    }));

    assert.equal(plan.needsDriveUpload, false);
    assert.equal(plan.driveFileId, 'orphan-file-9');
    assert.equal(plan.downloadUrl, 'https://drive.google.com/uc?export=download&id=orphan-file-9');
    assert.ok(plan.validations.includes('existing Drive APK com.evnsolution.clever.routes-1.1.2-9.apk with matching sha256 will be reused'));
    assert.match(plan.ssmCommand.join(' '), /--download-url 'https:\/\/drive\.google\.com\/uc\?export=download&id=orphan-file-9'/u);
  });

  it('rejects mixed same-name Drive duplicates unless every duplicate has the matching sha256', () => {
    assert.throws(() => createAndroidReleasePublicationPlan(publishInput({
      drive: {
        existingFiles: [
          {
            id: 'matching-file-9',
            name: 'com.evnsolution.clever.routes-1.1.2-9.apk',
            sha256,
          },
          {
            id: 'unverifiable-file-9',
            name: 'com.evnsolution.clever.routes-1.1.2-9.apk',
          },
        ],
        folderId: '15Am4CFvcp2szOuuKpGnWgJEB22H96rwZ',
      },
    })), /different or unverifiable sha256/u);

    const plan = createAndroidReleasePublicationPlan(publishInput({
      drive: {
        existingFiles: [
          {
            id: 'matching-file-9-a',
            name: 'com.evnsolution.clever.routes-1.1.2-9.apk',
            sha256,
          },
          {
            id: 'matching-file-9-b',
            name: 'com.evnsolution.clever.routes-1.1.2-9.apk',
            sha256,
          },
        ],
        folderId: '15Am4CFvcp2szOuuKpGnWgJEB22H96rwZ',
      },
    }));

    assert.equal(plan.needsDriveUpload, false);
    assert.equal(plan.driveFileId, 'matching-file-9-a');
  });

  it('keeps the public installUrl stable while SSM receives the Drive backing URL', () => {
    const plan = createAndroidReleasePublicationPlan(publishInput());

    assert.equal(plan.downloadUrl, buildDriveDownloadUrl('NEW_FILE_ID_AFTER_UPLOAD'));
    assert.match(plan.ssmCommand.join(' '), /--download-url 'https:\/\/drive\.google\.com\/uc\?export=download&id=NEW_FILE_ID_AFTER_UPLOAD'/u);
    assert.doesNotMatch(plan.ssmCommand.join(' '), /--download-url 'https:\/\/delivery\.example\.com\/routes-app'/u);
  });

  it('verifies public release metadata and anonymous download checksum after publish', () => {
    assert.doesNotThrow(() => createAndroidReleasePublicationPlan(publishInput({
      publishedRelease: {
        installUrl: 'https://delivery.example.com/routes-app',
        latestVersionCode: 9,
        latestVersionName: '1.1.2',
        minimumSupportedVersionCode: 8,
        platform: 'android',
      },
      publishedSha256: sha256,
    })));

    assert.throws(() => createAndroidReleasePublicationPlan(publishInput({
      publishedRelease: {
        installUrl: 'https://delivery.example.com/routes-app',
        latestVersionCode: 9,
        latestVersionName: '1.1.2',
        minimumSupportedVersionCode: 8,
        platform: 'android',
      },
      publishedSha256: 'b'.repeat(64),
    })), /anonymous \/routes-app\/download checksum does not match/u);
  });

  it('supports explicit legacy bootstrap without replacing the fixed Drive file content', () => {
    const plan = createAndroidReleasePublicationPlan(publishInput({
      apk: undefined,
      bootstrapSha256: sha256,
      currentRelease: undefined,
      mode: 'bootstrap-legacy',
    }));

    assert.equal(plan.mode, 'bootstrap-legacy');
    assert.equal(plan.driveFileName, undefined);
    assert.equal(plan.needsDriveUpload, false);
    assert.equal(plan.downloadUrl, 'https://drive.google.com/uc?export=download&id=1sqfU_D40iMenCGWQ6F3dZYb875i1jbe2');
    assert.match(plan.ssmCommand.join(' '), /--version-code 8 --version-name '1\.1\.1'/u);
    assert.ok(plan.validations.includes('legacy Drive file 1sqfU_D40iMenCGWQ6F3dZYb875i1jbe2 reused without content replacement'));
  });

  it('allows legacy bootstrap when the public env-fallback manifest already reports 1.1.1 versionCode 8', () => {
    const plan = createAndroidReleasePublicationPlan(publishInput({
      apk: undefined,
      bootstrapSha256: sha256,
      currentRelease: {
        installUrl: 'https://delivery.example.com/routes-app',
        latestVersionCode: 8,
        latestVersionName: '1.1.1',
        minimumSupportedVersionCode: 8,
        platform: 'android',
      },
      mode: 'bootstrap-legacy',
    }));

    assert.equal(plan.mode, 'bootstrap-legacy');
    assert.equal(plan.needsDriveUpload, false);
  });

  it('rejects only newer or mismatched same-code manifests during legacy bootstrap', () => {
    assert.throws(() => createAndroidReleasePublicationPlan(publishInput({
      apk: undefined,
      bootstrapSha256: sha256,
      currentRelease: {
        installUrl: 'https://delivery.example.com/routes-app',
        latestVersionCode: 9,
        latestVersionName: '1.1.2',
        minimumSupportedVersionCode: 8,
        platform: 'android',
      },
      mode: 'bootstrap-legacy',
    })), /versionCode rollback blocked/u);

    assert.throws(() => createAndroidReleasePublicationPlan(publishInput({
      apk: undefined,
      bootstrapSha256: sha256,
      currentRelease: {
        installUrl: 'https://delivery.example.com/routes-app',
        latestVersionCode: 8,
        latestVersionName: '1.1.0',
        minimumSupportedVersionCode: 8,
        platform: 'android',
      },
      mode: 'bootstrap-legacy',
    })), /legacy bootstrap versionName mismatch/u);
  });

  it('rejects a public manifest that exposes the raw Drive backing URL', () => {
    assert.throws(() => createAndroidReleasePublicationPlan(publishInput({
      publishedRelease: {
        installUrl: buildDriveDownloadUrl('NEW_FILE_ID_AFTER_UPLOAD'),
        latestVersionCode: 9,
        latestVersionName: '1.1.2',
        minimumSupportedVersionCode: 8,
        platform: 'android',
      },
      publishedSha256: sha256,
    })), /installUrl must stay on the server-owned \/routes-app URL/u);
  });
});
