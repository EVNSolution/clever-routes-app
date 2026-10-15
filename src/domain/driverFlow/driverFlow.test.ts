import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DRIVER_FLOW_STATES } from './driverFlow';

describe('driver app MVP flow', () => {
  it('keeps route context and company guidance before route access', () => {
    assert.deepEqual(DRIVER_FLOW_STATES, [
      'unidentified',
      'route_context_entered',
      'company_context_confirmed',
      'invited',
      'consent_required',
      'consent_recorded',
      'route_ready',
      'delivery_active',
      'delivery_finished',
    ]);
  });
});
