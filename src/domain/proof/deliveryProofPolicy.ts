import type { AssignedRoute } from '../route/assignedRoute';

export type DeliveryProofPolicy = Readonly<{ photoRequired: boolean; signatureRequired: boolean }>;
export type TollPolicy = 'ALLOW_TOLLS' | 'AVOID_TOLLS';
const OPTIONAL_PROOF: DeliveryProofPolicy = Object.freeze({ photoRequired: false, signatureRequired: false });

export function deliveryProofRequirements(route: Pick<AssignedRoute, 'deliveryProof'>): DeliveryProofPolicy {
  return route.deliveryProof ?? OPTIONAL_PROOF;
}

export function isDeliveryProofPolicy(value: unknown): value is DeliveryProofPolicy {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof (value as DeliveryProofPolicy).photoRequired === 'boolean'
    && typeof (value as DeliveryProofPolicy).signatureRequired === 'boolean';
}

export function validateDeliveryProof(route: Pick<AssignedRoute, 'deliveryProof'>, proof: { photoUri?: string; signatureUri?: string }): string | null {
  const policy = deliveryProofRequirements(route);
  if (policy.photoRequired && !proof.photoUri) return 'Take a delivery photo before completing this stop.';
  if (policy.signatureRequired && !proof.signatureUri) return 'Collect the customer signature before completing this stop.';
  return null;
}
