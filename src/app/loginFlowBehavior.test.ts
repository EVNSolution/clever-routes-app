import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const appRootPath = join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx');

describe('driver login flow', () => {
  it('uses phone then PIN login, with invite code only in first-registration mode', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const loginDetailScreen = source.slice(
      source.indexOf('function LoginDetailScreen'),
      source.indexOf('function MyRoutesPage'),
    );

    assert.match(loginDetailScreen, /label="6-digit PIN"/u);
    assert.match(loginDetailScreen, /isRegistration/u);
    assert.match(loginDetailScreen, /label="Invite Code"/u);
    assert.match(loginDetailScreen, /label="Confirm PIN"/u);
    assert.match(source, /driverAuthService\.login/u);
    assert.match(source, /driverAuthService\.register/u);
    assert.doesNotMatch(source, /saveVerifiedDriver/u);
    assert.doesNotMatch(source, /displayName:/u);
    assert.doesNotMatch(loginDetailScreen, /label="First Name"/u);
    assert.doesNotMatch(loginDetailScreen, /label="Last Name"/u);
    assert.doesNotMatch(source, /Enter your first and last name/u);
  });

  it('opens country selection as a full page without focusing search on entry', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const countrySelectionScreen = source.slice(
      source.indexOf('function CountrySelectionScreen'),
      source.indexOf('function PhoneNumberInput'),
    );

    assert.match(source, /\| 'countrySelect'/u);
    assert.match(source, /case 'countrySelect':[\s\S]*setScreen\('loginPhone'\)/u);
    assert.match(source, /const isCountrySelectionScreen = screen === 'countrySelect'/u);
    assert.match(source, /isCountrySelectionScreen \? \([\s\S]*<CountrySelectionScreen/u);
    assert.match(countrySelectionScreen, /<FixedScreenHeader onBack=\{onBack\} title="Select Country" topInset=\{topInset\} \/>/u);
    assert.match(countrySelectionScreen, /<LabeledInput[\s\S]*label="Search Country"/u);
    assert.match(countrySelectionScreen, /<ScrollView/u);
    assert.doesNotMatch(countrySelectionScreen, /autoFocus/u);
  });

  it('restores account identity behind a loading surface and syncs routes separately', () => {
    const source = readFileSync(appRootPath, 'utf8');

    assert.match(source, /type RouteSyncState = 'error' \| 'idle' \| 'loading' \| 'ready'/u);
    assert.match(source, /const \[driverRestoreProblem, setDriverRestoreProblem\] = useState<string \| null>\(null\)/u);
    assert.match(source, /!isDriverRestoreComplete \? \([\s\S]*<DriverRestoreScreen/u);
    assert.match(source, /function DriverRestoreScreen\([\s\S]*Restoring your session[\s\S]*Try Again/u);
    assert.match(source, /setVerifiedDriverPhoneE164\(result\.driverProfile\.phoneE164\);[\s\S]*setScreen\('mainTabs'\);[\s\S]*setIsDriverRestoreComplete\(true\);[\s\S]*handleLoginAndLoadRoutes/u);
    assert.match(source, /shouldDiscardSavedLoginAfterRefreshFailure\(error\)[\s\S]*driverAccessTokenStore\.clear\(\)/u);
    assert.match(source, /setDriverRestoreProblem\('Your saved login is safe\. Check your connection and try again\.'\)/u);
    assert.match(source, /DRIVER_RESTORE_LOADING_TIMEOUT_MS/u);
    assert.match(source, /setDriverRestoreProblem\('Session check is taking longer than expected\. Try again\.'\)/u);
    assert.match(
      source,
      /if \(result\.kind !== 'active' && result\.kind !== 'refresh_required'\) \{\s+clearTimeout\(restoreWatchdog\);\s+setScreen\('loginPhone'\);\s+setIsDriverRestoreComplete\(true\);\s+void clearAndStopActiveLocationSession\(\)/u,
    );
    assert.doesNotMatch(source, /hasAttemptedDriverRestoreRef/u);
    assert.doesNotMatch(source, /attemptedDriverRestoreRef/u);
    assert.match(source, /useEffect\(\(\) => \{\s+if \(isDriverRestoreComplete\) \{\s+return undefined;\s+\}\s+let isMounted = true;\s+const restoreWatchdog/u);
    assert.match(source, /routeSyncState === 'loading'[\s\S]*Loading routes/u);
    assert.match(source, /routeSyncState === 'error'[\s\S]*Routes temporarily unavailable[\s\S]*Retry/u);
    assert.match(source, /previousDriverRestoreNetworkRef[\s\S]*networkReachability === 'online'[\s\S]*retryDriverRestore/u);
    assert.match(source, /previousRouteSyncNetworkRef[\s\S]*networkReachability === 'online'[\s\S]*handleRefreshRoutes/u);
  });
});
