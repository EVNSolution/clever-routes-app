import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const appRootPath = join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx');

function getSettingsPageSource(): string {
  const source = readFileSync(appRootPath, 'utf8');
  const start = source.indexOf('function SettingsPage(');
  const end = source.indexOf('function RouteSessionScreen(', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  return source.slice(start, end);
}

function getAccountNamePageSource(): string {
  const source = readFileSync(appRootPath, 'utf8');
  const start = source.indexOf('function AccountNamePage(');
  const end = source.indexOf('function RouteSessionScreen(', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  return source.slice(start, end);
}

describe('Settings page behavior', () => {
  it('uses an inset-grouped account summary with only working settings', () => {
    const settingsPage = getSettingsPageSource();
    const source = readFileSync(appRootPath, 'utf8');

    assert.match(source, /screen === 'settings' \? \([\s\S]*<FixedScreenHeader onBack=\{handleAppBack\} title="Settings"/u);
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
    assert.match(settingsPage, />ACCOUNT ACTIONS</u);
    assert.match(settingsPage, /accessibilityLabel="Delete Account"/u);
    assert.match(settingsPage, /onPress=\{onRequestAccountDeletion\}/u);
    assert.match(settingsPage, /accessibilityLabel="Sign Out"/u);
    assert.match(settingsPage, /onPress=\{onLogout\}/u);

    assert.doesNotMatch(settingsPage, /Profile editing|Display Name|Store Name/u);
    assert.match(settingsPage, />STOP NAVIGATION APP</u);
    assert.match(settingsPage, />Google Maps</u);
    assert.match(settingsPage, /Open Route uses Google Maps for multi-stop directions\./u);
    assert.match(settingsPage, /accessibilityLabel="Use Google Maps for navigation"/u);
    assert.match(settingsPage, /accessibilityLabel="Use Waze for navigation"/u);
    assert.match(settingsPage, /navigationProvider === 'google'/u);
    assert.match(settingsPage, /navigationProvider === 'waze'/u);
    assert.match(settingsPage, /onChangeNavigationProvider\('google'\)/u);
    assert.match(settingsPage, /onChangeNavigationProvider\('waze'\)/u);
    assert.doesNotMatch(settingsPage, /Logout and reset this device/u);
    assert.doesNotMatch(settingsPage, /Needs Review|CONSENT_COPY_VERSIONS|Allowed \u00b7|Denied \u00b7/u);
  });

  it('restores the saved navigation provider and persists changes from Settings', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const settingsPage = getSettingsPageSource();

    assert.match(source, /const \[navigationProvider, setNavigationProvider\] = useState<NavigationProvider \| null>\(null\)/u);
    assert.match(source, /const \[navigationPreferenceLoadFailed, setNavigationPreferenceLoadFailed\] = useState\(false\)/u);
    assert.match(source, /const navigationPreferenceRevisionRef = useRef\(0\)/u);
    assert.match(source, /const loadRevision = navigationPreferenceRevisionRef\.current[\s\S]*navigationPreferenceStore\.load\(\)[\s\S]*navigationPreferenceRevisionRef\.current === loadRevision[\s\S]*setNavigationProvider\(savedProvider\)/u);
    assert.match(source, /async function handleChangeNavigationProvider\(provider: NavigationProvider\)/u);
    assert.match(source, /navigationPreferenceRevisionRef\.current \+= 1[\s\S]*setNavigationProvider\(provider\)[\s\S]*await navigationPreferenceStore\.save\(provider\)/u);
    assert.match(source, /catch \{[\s\S]*const persistedProvider = await navigationPreferenceStore\.load\(\)[\s\S]*setNavigationProvider\(persistedProvider\)/u);
    assert.match(source, /navigationProvider === null[\s\S]*navigationPreferenceLoadFailed[\s\S]*Restart the app to retry[\s\S]*Navigation app setting is still loading/u);
    assert.match(settingsPage, /navigationPreferenceLoadFailed[\s\S]*Stop navigation preference is unavailable\. Restart the app to retry\.[\s\S]*Loading stop navigation preference/u);
    assert.match(source, /<SettingsPage[\s\S]*navigationProvider=\{navigationProvider\}[\s\S]*onChangeNavigationProvider=\{\(provider\) => \{ void handleChangeNavigationProvider\(provider\); \}\}/u);
  });

  it('opens the published policy and restores consent for an authenticated session', () => {
    const source = readFileSync(appRootPath, 'utf8');

    assert.match(source, /DRIVER_CONSENT_DOCUMENT_URL/u);
    assert.match(source, /Linking\.openURL\(DRIVER_CONSENT_DOCUMENT_URL\)/u);
    assert.match(
      source,
      /setAcceptedPrivacy\(true\);\s+setAcceptedLocation\(true\);\s+setScreen\('mainTabs'\);\s+setIsDriverRestoreComplete\(true\);\s+await handleLoginAndLoadRoutes/u,
    );
  });

  it('edits the global CLEVER Routes account name on a dedicated page', () => {
    const accountNamePage = getAccountNamePageSource();
    const source = readFileSync(appRootPath, 'utf8');

    assert.match(source, /screen === 'accountName' \? \([\s\S]*title="Name"/u);
    assert.match(accountNamePage, /label="Name"/u);
    assert.match(accountNamePage, /maxLength=\{80\}/u);
    assert.match(accountNamePage, /autoCapitalize="words"/u);
    assert.match(accountNamePage, /placeholder="Your name"/u);
    assert.match(accountNamePage, /This is your name in CLEVER Routes\. Store display names can be different\./u);
    assert.match(accountNamePage, /label="Save"/u);
    assert.match(accountNamePage, /onPress=\{onSave\}/u);
    assert.match(source, /driverAuthService\.getAccountProfile/u);
    assert.match(source, /driverAuthService\.updateAccountProfile/u);
    assert.match(source, /const accountAccess = await getActiveAccountAccess\(\)/u);
  });

  it('does not let a completed name save override Back navigation', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const saveStart = source.indexOf('async function handleSaveAccountName()');
    const saveEnd = source.indexOf('\n\n  const refreshRouteAccessLookupForSubmission', saveStart);
    const saveSource = source.slice(saveStart, saveEnd);

    assert.notEqual(saveStart, -1);
    assert.notEqual(saveEnd, -1);
    assert.match(saveSource, /const requestScreen = screenRef\.current/u);
    assert.match(saveSource, /if \(screenRef\.current === requestScreen\) \{[\s\S]*setScreen\('settings'\);[\s\S]*\}/u);
  });

  it('requires confirmation and preserves unsynced delivery evidence before requesting deletion', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const handlerStart = source.indexOf('function handleRequestAccountDeletion()');
    const handlerEnd = source.indexOf('\n\n  const refreshRouteAccessLookupForSubmission', handlerStart);
    const handlerSource = source.slice(handlerStart, handlerEnd);

    assert.notEqual(handlerStart, -1);
    assert.notEqual(handlerEnd, -1);
    assert.match(handlerSource, /showOperationalDialog\(\s*'Delete CLEVER Routes account\?'/u);
    assert.match(handlerSource, /style: 'destructive'/u);
    assert.match(handlerSource, /getOfflineSubmissionQueueSummary\(queue\)/u);
    assert.match(handlerSource, /queueSummary\.totalCount > 0/u);
    assert.match(handlerSource, /driverAuthService\.requestAccountDeletion/u);
    assert.match(handlerSource, /queue\.completeAccountDeletionAfterServerAudit\(\)/u);
    assert.match(handlerSource, /await waitForOfflineQueuePersistence\(queue\)/u);
    assert.match(handlerSource, /await handleLogout\(\)/u);
    assert.match(handlerSource, /isDriverAccountDeletionActiveRouteError/u);
  });

  it('uses quiet grouped-list styling instead of dashboard cards', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const settingsStyles = source.slice(
      source.indexOf('settingsScreen:'),
      source.indexOf('summaryCard:'),
    );

    assert.doesNotMatch(settingsStyles, /settingsHeader:|settingsBackButton:/u);
    assert.match(settingsStyles, /settingsSectionLabel:/u);
    assert.match(settingsStyles, /settingsGroup:/u);
    assert.match(settingsStyles, /settingsRow:/u);
    assert.match(settingsStyles, /settingsRowSeparated:/u);
    assert.match(settingsStyles, /settingsDeleteAccountText:/u);
    assert.match(settingsStyles, /settingsSignOutText:/u);
    assert.doesNotMatch(settingsStyles, /\.\.\.shadow/u);
  });
});
