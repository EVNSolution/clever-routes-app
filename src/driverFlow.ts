export const DRIVER_FLOW_STATES = [
  'unidentified',
  'route_context_entered',
  'company_context_confirmed',
  'invited',
  'consent_required',
  'consent_recorded',
  'route_ready',
  'delivery_active',
  'delivery_finished',
] as const;

export type DriverFlowState = (typeof DRIVER_FLOW_STATES)[number];

export type InitialAccessValidationInput = {
  routeContext: string;
  phoneE164: string;
};

export type InitialAccessValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'route_context_required' | 'phone_required' | 'phone_invalid';
    };

export type DeliveryActiveGuardInput = {
  state: DriverFlowState;
  hasLocationPermission: boolean;
};

export type PlaceholderScreenId =
  | 'routeAccess'
  | 'companyGuidance'
  | 'consentGate'
  | 'assignedRoute'
  | 'deliveryActive';

export type PlaceholderScreen = {
  id: PlaceholderScreenId;
  title: string;
  state: DriverFlowState;
  purpose: string;
  primaryAction: string;
};

const ROUTE_REVEAL_STATES = new Set<DriverFlowState>([
  'consent_recorded',
  'route_ready',
  'delivery_active',
  'delivery_finished',
]);

const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

export function getInitialAccessValidation({
  routeContext,
  phoneE164,
}: InitialAccessValidationInput): InitialAccessValidationResult {
  if (routeContext.trim().length === 0) {
    return { ok: false, reason: 'route_context_required' };
  }

  if (phoneE164.trim().length === 0) {
    return { ok: false, reason: 'phone_required' };
  }

  if (!E164_PHONE_PATTERN.test(phoneE164.trim())) {
    return { ok: false, reason: 'phone_invalid' };
  }

  return { ok: true };
}

export function canRevealRouteDetails(state: DriverFlowState): boolean {
  return ROUTE_REVEAL_STATES.has(state);
}

export function canEnterDeliveryActive({
  state,
  hasLocationPermission,
}: DeliveryActiveGuardInput): boolean {
  return state === 'route_ready' && hasLocationPermission;
}

export function getPlaceholderScreens(): PlaceholderScreen[] {
  return [
    {
      id: 'routeAccess',
      title: 'Route access',
      state: 'route_context_entered',
      purpose: 'Collect a route invite/code and E.164 phone number before any server lookup.',
      primaryAction: 'Validate route context + phone',
    },
    {
      id: 'companyGuidance',
      title: 'Company guidance',
      state: 'company_context_confirmed',
      purpose: 'Show the matched company/shop route context before revealing route details.',
      primaryAction: 'Confirm this is my delivery work',
    },
    {
      id: 'consentGate',
      title: 'Consent gate',
      state: 'consent_required',
      purpose: 'Require location-information and personal-information consent before route access.',
      primaryAction: 'Record required consents',
    },
    {
      id: 'assignedRoute',
      title: 'Assigned route',
      state: 'route_ready',
      purpose: 'Display today\'s assigned route after consent is recorded by the server.',
      primaryAction: 'Review route and stops',
    },
    {
      id: 'deliveryActive',
      title: 'Delivery active',
      state: 'delivery_active',
      purpose: 'Start foreground/background location flow only after explicit delivery start.',
      primaryAction: 'Start delivery with OS location permission',
    },
  ];
}
