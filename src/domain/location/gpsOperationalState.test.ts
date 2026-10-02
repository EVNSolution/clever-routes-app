import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyGpsOperationalState } from './gpsOperationalState';

describe('GPS operational state', () => {
  it('uses the canonical 120-second fresh and 300-second aging boundaries', () => {
    const now = new Date('2026-08-22T14:05:00.000Z');
    const classifyAtAge = (ageMs: number) => classifyGpsOperationalState({
      accuracyMeters: 25,
      capturedAt: new Date(now.getTime() - ageMs).toISOString(),
      distanceMeters: 80,
      now,
    });

    assert.equal(classifyAtAge(120_000).freshness, 'fresh');
    assert.equal(classifyAtAge(120_001).freshness, 'aging');
    assert.equal(classifyAtAge(300_000).freshness, 'aging');
    assert.equal(classifyAtAge(300_001).freshness, 'stale');
  });

  it('separates freshness, accuracy, and safe proximity eligibility', () => {
    const now = new Date('2026-08-22T14:05:00.000Z');
    assert.deepEqual(classifyGpsOperationalState({ accuracyMeters: 25, capturedAt: '2026-08-22T14:04:45.000Z', distanceMeters: 80, now }), {
      accuracy: 'accurate', freshness: 'fresh', proximity: 'within', safeForProximity: true,
    });
    assert.deepEqual(classifyGpsOperationalState({ accuracyMeters: 150, capturedAt: '2026-08-22T14:04:45.000Z', distanceMeters: 20, now }), {
      accuracy: 'poor', freshness: 'fresh', proximity: 'unknown', safeForProximity: false,
    });
    assert.deepEqual(classifyGpsOperationalState({ accuracyMeters: 10, capturedAt: '2026-08-22T13:59:59.999Z', distanceMeters: 20, now }), {
      accuracy: 'accurate', freshness: 'stale', proximity: 'unknown', safeForProximity: false,
    });
  });
});
