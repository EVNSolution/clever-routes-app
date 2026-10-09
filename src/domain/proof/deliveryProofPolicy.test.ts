import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAssignedRoute, sampleAssignedRoute } from '../route/assignedRoute';
import { deliveryProofRequirements, validateDeliveryProof } from './deliveryProofPolicy';

describe('configured delivery proof', () => {
  it('keeps old route caches valid and both requirements off by default', () => {
    assert.equal(isAssignedRoute(sampleAssignedRoute), true);
    assert.deepEqual(deliveryProofRequirements(sampleAssignedRoute), { photoRequired: false, signatureRequired: false });
    assert.equal(validateDeliveryProof(sampleAssignedRoute, {}), null);
  });
  it('requires only configured evidence and does not accept a photo as a signature', () => {
    const route = { ...sampleAssignedRoute, deliveryProof: { photoRequired: true, signatureRequired: true } };
    assert.match(validateDeliveryProof(route, {})!, /photo/i);
    assert.match(validateDeliveryProof(route, { photoUri: 'file:///photo.jpg' })!, /signature/i);
    assert.equal(validateDeliveryProof(route, { photoUri: 'file:///photo.jpg', signatureUri: 'file:///signature.png' }), null);
  });
  it('rejects malformed server options rather than silently disabling required proof', () => {
    assert.equal(isAssignedRoute({ ...sampleAssignedRoute, deliveryProof: { photoRequired: 'true', signatureRequired: false } }), false);
    assert.equal(isAssignedRoute({ ...sampleAssignedRoute, tollPolicy: 'UNKNOWN' }), false);
  });
});
