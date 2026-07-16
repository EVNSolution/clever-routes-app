import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const appRootPath = join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx');

function getSettingsPageSource(): string {
  const source = readFileSync(appRootPath, 'utf8');
  const start = source.indexOf('function SettingsPage(');
  const end = source.indexOf('function RoutePreviewRegionBlock', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  return source.slice(start, end);
}

function getAccountNamePageSource(): string {
  const source = readFileSync(appRootPath, 'utf8');
  const start = source.indexOf('function AccountNamePage(');
  const end = source.indexOf('function RoutePreviewRegionBlock', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  return source.slice(start, end);
}

describe('Settings page behavior', () => {
  it('uses an inset-grouped account summary with only working settings', () => {
    const settingsPage = getSettingsPageSource();

    assert.match(settingsPage, /accessibilityLabel="Back"/u);
    assert.match(settingsPage, /name="chevron-back"/u);
    assert.match(settingsPage, />ACCOUNT</u);
    assert.match(settingsPage, />Name</u);
    assert.match(settingsPage, /accessibilityLabel="Change Name"/u);
    assert.match(settingsPage, /name="chevron-forward"/u);
    assert.match(settingsPage, /onPress=\{onEditName\}/u);
    assert.match(settingsPage, /isLoadingAccountProfile \? 'Loading…' : accountName \?\? 'Not set'/u);
    assert.match(settingsPage, />Phone Number</u);
    assert.match(settingsPage, />CONSENT</u);
    assert.match(settingsPage, />Privacy</u);
    assert.match(settingsPage, />Location</u);
    assert.match(settingsPage, /accessibilityLabel="Read Privacy Policy"/u);
    assert.match(settingsPage, /accessibilityLabel="Read Location Policy"/u);
    assert.match(settingsPage, /onPress=\{onOpenConsentDocument\}/u);
    assert.match(settingsPage, /acceptedPrivacy \? 'Allowed' : 'Denied'/u);
    assert.match(settingsPage, /acceptedLocation \? 'Allowed' : 'Denied'/u);
    assert.match(settingsPage, />ABOUT</u);
    assert.match(settingsPage, />Version</u);
    assert.match(settingsPage, /accessibilityLabel="Sign Out"/u);
    assert.match(settingsPage, /onPress=\{onLogout\}/u);

    assert.doesNotMatch(settingsPage, /Profile editing|Display Name|Store Name/u);
    assert.doesNotMatch(settingsPage, /Account deletion|Navigation App|Navigation Mode/u);
    assert.doesNotMatch(settingsPage, /Logout and reset this device/u);
    assert.doesNotMatch(settingsPage, /Needs Review|CONSENT_COPY_VERSIONS|Allowed ·|Denied ·/u);
  });

  it('opens the published policy and restores consent for an authenticated session', () => {
    const source = readFileSync(appRootPath, 'utf8');

    assert.match(source, /DRIVER_CONSENT_DOCUMENT_URL/u);
    assert.match(source, /Linking\.openURL\(DRIVER_CONSENT_DOCUMENT_URL\)/u);
    assert.match(source, /setAcceptedPrivacy\(true\);\s+setAcceptedLocation\(true\);\s+await handleLoginAndLoadRoutes/u);
  });

  it('edits the global Clever Driver account name on a dedicated page', () => {
    const accountNamePage = getAccountNamePageSource();
    const source = readFileSync(appRootPath, 'utf8');

    assert.match(accountNamePage, /settingsHeaderTitle\}>Name/u);
    assert.match(accountNamePage, /label="Name"/u);
    assert.match(accountNamePage, /maxLength=\{80\}/u);
    assert.match(accountNamePage, /autoCapitalize="words"/u);
    assert.match(accountNamePage, /placeholder="Your name"/u);
    assert.match(accountNamePage, /This is your name in Clever Driver\. Store display names can be different\./u);
    assert.match(accountNamePage, /label="Save"/u);
    assert.match(accountNamePage, /onPress=\{onSave\}/u);
    assert.match(source, /driverAuthService\.getAccountProfile/u);
    assert.match(source, /driverAuthService\.updateAccountProfile/u);
    assert.match(source, /const accountAccess = await getActiveAccountAccess\(\)/u);
  });

  it('uses quiet grouped-list styling instead of dashboard cards', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const settingsStyles = source.slice(
      source.indexOf('settingsScreen:'),
      source.indexOf('summaryCard:'),
    );

    assert.match(settingsStyles, /settingsHeader:/u);
    assert.match(settingsStyles, /settingsBackButton:/u);
    assert.match(settingsStyles, /settingsSectionLabel:/u);
    assert.match(settingsStyles, /settingsGroup:/u);
    assert.match(settingsStyles, /settingsRow:/u);
    assert.match(settingsStyles, /settingsRowSeparated:/u);
    assert.match(settingsStyles, /settingsSignOutText:/u);
    assert.doesNotMatch(settingsStyles, /\.\.\.shadow/u);
  });
});
