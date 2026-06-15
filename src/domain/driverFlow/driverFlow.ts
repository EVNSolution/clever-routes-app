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
  routeContext?: string | null;
  phoneE164: string;
};

export type InitialAccessValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'phone_required' | 'phone_invalid';
    };

export type DeliveryActiveGuardInput = {
  state: DriverFlowState;
  hasLocationPermission: boolean;
};

export type MvpScenarioScreenId =
  | 'login'
  | 'routeList'
  | 'routeDetail'
  | 'liveTracking'
  | 'stopDetails'
  | 'arrivalCheck'
  | 'stopCompleted'
  | 'completedDeliveries';

export type MvpScenarioScreen = {
  id: MvpScenarioScreenId;
  title: string;
  purpose: string;
  primaryAction: string;
};

export type MvpRouteTab = {
  id: 'active' | 'completed' | 'unfinished' | 'upcoming';
  label: 'Completed' | 'In Progress' | 'Pending' | 'Unfinished';
};

export type StopCompletionProofField = {
  id: 'additionalNotes' | 'locationTip' | 'photo' | 'todayNote';
  label: string;
  required: boolean;
};

const ROUTE_REVEAL_STATES = new Set<DriverFlowState>([
  'consent_recorded',
  'route_ready',
  'delivery_active',
  'delivery_finished',
]);

const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

export function getInitialAccessValidation({
  phoneE164,
}: InitialAccessValidationInput): InitialAccessValidationResult {
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

export function getMvpScenarioScreens(): MvpScenarioScreen[] {
  return [
    {
      id: 'login',
      title: 'Login / Driver Verification',
      purpose:
        'Confirm the driver by phone, then collect name and required consent.',
      primaryAction: 'Continue',
    },
    {
      id: 'routeList',
      title: 'Upcoming Routes',
      purpose:
        'Show current, unfinished, and future assigned routes from nearest date to farthest, grouped into Pending, In Progress, Unfinished, and Completed tabs.',
      primaryAction: 'Start Session',
    },
    {
      id: 'routeDetail',
      title: 'Route Details',
      purpose:
        'Show company information, route date, region, and ordered stops before delivery starts.',
      primaryAction: 'Start Session',
    },
    {
      id: 'liveTracking',
      title: 'Live Tracking',
      purpose:
        'Show GPS tracking status and route overview without turn-by-turn navigation.',
      primaryAction: 'Arrived',
    },
    {
      id: 'stopDetails',
      title: 'Stop Details',
      purpose:
        'Show address, delivery instructions, location tips, and contact actions for the current stop.',
      primaryAction: 'Arrived',
    },
    {
      id: 'arrivalCheck',
      title: 'Arrival Check',
      purpose:
        'Collect required photo proof, delivery notes, location tips, and optional notes at the stop.',
      primaryAction: 'Complete Stop',
    },
    {
      id: 'stopCompleted',
      title: 'Stop Completed',
      purpose:
        'Confirm stop completion and guide the driver to the next stop or route summary.',
      primaryAction: 'Find Next Stop',
    },
    {
      id: 'completedDeliveries',
      title: 'Completed Deliveries',
      purpose:
        'Show completed stops and proof status for the selected route or day.',
      primaryAction: 'Back to Route',
    },
  ];
}

export function getMvpRouteTabs(): MvpRouteTab[] {
  return [
    { id: 'upcoming', label: 'Pending' },
    { id: 'active', label: 'In Progress' },
    { id: 'unfinished', label: 'Unfinished' },
    { id: 'completed', label: 'Completed' },
  ];
}

export function getStopCompletionProofFields(): StopCompletionProofField[] {
  return [
    { id: 'photo', label: 'Photo Proof', required: true },
    { id: 'todayNote', label: 'Delivery Notes', required: false },
    { id: 'locationTip', label: 'Location Tip', required: false },
    { id: 'additionalNotes', label: 'Additional Notes', required: false },
  ];
}
