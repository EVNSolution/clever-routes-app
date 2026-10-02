import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseDriverDiagnosticResponse } from './driverDiagnosticResponse';

describe('driver diagnostic server response', () => {
  it('preserves known and future rejection codes for the domain transport decision', () => {
    assert.deepEqual(parseDriverDiagnosticResponse({
      acceptedDiagnosticIds: ['11111111-1111-4111-8111-111111111111'],
      rejectedDiagnostics: [
        { diagnosticId: '22222222-2222-4222-8222-222222222222', code: 'INVALID_RECORD' },
        { diagnosticId: '33333333-3333-4333-8333-333333333333', code: 'FUTURE_REJECTION' },
      ],
      serverReceivedAt: '2026-10-01T14:05:00.000Z',
    }), {
      acceptedDiagnosticIds: ['11111111-1111-4111-8111-111111111111'],
      rejectedDiagnostics: [
        { diagnosticId: '22222222-2222-4222-8222-222222222222', code: 'INVALID_RECORD' },
        { diagnosticId: '33333333-3333-4333-8333-333333333333', code: 'FUTURE_REJECTION' },
      ],
      serverReceivedAt: '2026-10-01T14:05:00.000Z',
    });
  });

  it('rejects malformed entries instead of treating them as acknowledged', () => {
    assert.equal(parseDriverDiagnosticResponse({
      acceptedDiagnosticIds: [],
      rejectedDiagnostics: [{ diagnosticId: 'id-without-code' }],
      serverReceivedAt: '2026-10-01T14:05:00.000Z',
    }), null);
    assert.equal(parseDriverDiagnosticResponse({
      acceptedDiagnosticIds: [],
      serverReceivedAt: '2026-10-01T14:05:00.000Z',
    }), null);
  });
});
