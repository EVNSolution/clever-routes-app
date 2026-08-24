import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { buildOperationalPills } from './operationalPillModel';

describe('operational pills', () => {
  it('keeps Alert, Route, GPS, Device, Server, and Sync independently labeled', () => {
    assert.deepEqual(buildOperationalPills({
      alert: 'None', device: 'This device', gps: 'Fresh', route: 'Active', server: 'Healthy', sync: '1 pending',
    }).map((pill) => pill.label), ['Alert', 'Route', 'GPS', 'Device', 'Server', 'Sync']);
  });

  it('uses accessible pill values without separator-dot presentation', () => {
    const source = readFileSync(new URL('./OperationalPills.tsx', import.meta.url), 'utf8');
    assert.match(source, /accessibilityLabel=\{`\$\{pill\.label\}: \$\{pill\.value\}`\}/u);
    assert.doesNotMatch(source, /[•·]/u);
  });
});
