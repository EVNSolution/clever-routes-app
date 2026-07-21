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

export type DeliveryActiveGuardInput = {
  state: DriverFlowState;
  hasLocationPermission: boolean;
};

export type MvpScenarioScreenId =
  | 'login'
  | 'routeList'
  | 'routeDetail'
  | 'routeSession'
  | 'liveTracking'
  | 'stopDetails'
  | 'arrivalCheck'
  | 'completedDeliveries';

export type MvpScenarioScreen = {
  id: MvpScenarioScreenId;
  title: string;
  purpose: string;
  primaryAction: string;
};

export type MvpRouteTab = {
  id: 'active' | 'completed' | 'ready';
  label: 'Completed' | 'In progress' | 'Ready';
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
        'Authenticate by phone and PIN, then collect required consent.',
      primaryAction: 'Continue',
    },
    {
      id: 'routeList',
      title: 'My Routes',
      purpose:
        'Show assigned routes from nearest date to farthest, grouped into Ready, In progress, and Completed tabs.',
      primaryAction: 'Start Session',
    },
    // routeDetail is metadata for the read-only preview entry; the live operational screen is routeSession.
    {
      id: 'routeDetail',
      title: 'Route Details',
      purpose:
        'Show a compact read-only preview with date, map, region, stop count, distance, time, and sequence.',
      primaryAction: 'Review Route',
    },
    {
      id: 'routeSession',
      title: 'Route Session',
      purpose:
        'Run the operational pickup, navigation, stop, proof, and completion workflow after Start or Continue Session.',
      primaryAction: 'Continue Session',
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
        'Optionally add a delivery photo, result, location tip, or note before completing the stop.',
      primaryAction: 'Complete Stop',
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
    { id: 'ready', label: 'Ready' },
    { id: 'active', label: 'In progress' },
    { id: 'completed', label: 'Completed' },
  ];
}

export function getStopCompletionProofFields(): StopCompletionProofField[] {
  return [
    { id: 'photo', label: 'Photo Proof', required: false },
    { id: 'todayNote', label: 'Delivery Result', required: false },
    { id: 'locationTip', label: 'Location Tip', required: false },
    { id: 'additionalNotes', label: 'Other Notes', required: false },
  ];
}
