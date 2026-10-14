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
