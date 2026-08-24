import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyGpsOperationalState } from './gpsOperationalState';

describe('GPS operational state', () => {
  it('separates freshness, accuracy, and safe proximity eligibility', () => {
    const now = new Date('2026-08-22T14:05:00.000Z');
    assert.deepEqual(classifyGpsOperationalState({ accuracyMeters: 25, capturedAt: '2026-08-22T14:04:45.000Z', distanceMeters: 80, now }), {
      accuracy: 'accurate', freshness: 'fresh', proximity: 'within', safeForProximity: true,
    });
    assert.deepEqual(classifyGpsOperationalState({ accuracyMeters: 150, capturedAt: '2026-08-22T14:04:45.000Z', distanceMeters: 20, now }), {
      accuracy: 'poor', freshness: 'fresh', proximity: 'unknown', safeForProximity: false,
    });
    assert.deepEqual(classifyGpsOperationalState({ accuracyMeters: 10, capturedAt: '2026-08-22T14:02:00.000Z', distanceMeters: 20, now }), {
      accuracy: 'accurate', freshness: 'stale', proximity: 'unknown', safeForProximity: false,
    });
  });
});
