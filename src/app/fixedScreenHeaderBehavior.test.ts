import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const appRootPath = join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx');
const headerPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../ui/components/FixedScreenHeader.tsx',
);

describe('fixed screen header behavior', () => {
  it('uses an accessible back icon without visible Back copy', () => {
    const source = readFileSync(headerPath, 'utf8');

    assert.match(source, /accessibilityLabel="Back"/u);
    assert.match(source, /name="chevron-back"/u);
    assert.doesNotMatch(source, />Back</u);
  });

  it('keeps standard page headers outside the scrolling content', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const frameStart = source.indexOf('<View style={styles.standardScreenFrame}>');
    const scrollStart = source.indexOf('<ScrollView', frameStart);
    const headerStart = source.indexOf('{standardScreenHeader}', frameStart);

    assert.notEqual(frameStart, -1);
    assert.notEqual(scrollStart, -1);
    assert.notEqual(headerStart, -1);
    assert.ok(headerStart < scrollStart);
    assert.match(source, /screen === 'mainTabs'[\s\S]*rightIcon="settings"[\s\S]*title="My Routes"/u);
    assert.doesNotMatch(source, /function ScreenHeader\(/u);
  });
});
