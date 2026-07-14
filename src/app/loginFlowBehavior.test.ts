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
      source.indexOf('function HomePage'),
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
});
