import { isDeliveryDateToday } from './deliveryDay';

type LoadedRouteSession = {
  companyGuidance: { executionStatus?: string };
  pendingRouteEnd?: unknown;
  route: { id: string; deliveryDate: string; timezone?: string | null };
};

export function selectLoadedRouteSession<T extends LoadedRouteSession>(
  sessions: readonly T[],
  input: {
    currentSelectedRouteId: string | null;
    restoredActiveRouteId: string | null;
    preferTodayReadyRoute: boolean;
    now?: Date;
  },
): T | undefined {
  const active = sessions.find(session => session.route.id === input.restoredActiveRouteId);
  if (active !== undefined) return active;
  const selected = sessions.find(session => session.route.id === input.currentSelectedRouteId);
  if (input.preferTodayReadyRoute) {
    const now = input.now ?? new Date();
    const isEligible = (session: T): boolean => session.companyGuidance.executionStatus === 'READY'
      && session.pendingRouteEnd === undefined
      && isDeliveryDateToday(session.route.deliveryDate, session.route.timezone, now);
    if (selected !== undefined && isEligible(selected)) return selected;
    const today = sessions.find(isEligible);
    if (today !== undefined) return today;
  }
  return selected ?? sessions[0];
}
