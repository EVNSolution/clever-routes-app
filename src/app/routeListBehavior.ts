import type { RouteSessionStatus } from '../domain/route/routeSessionClassification';

export function getRouteListStatus(session: {
  companyGuidance: { executionStatus?: string };
  localRouteEnd?: { assignmentGeneration: string; kind: 'completed' | 'released' };
  pendingRouteEnd?: 'completed' | 'released';
  routeAccess: { assignmentGeneration: string };
}, fallback: RouteSessionStatus): RouteSessionStatus {
  const localEnd = session.localRouteEnd?.assignmentGeneration === session.routeAccess.assignmentGeneration
    ? session.localRouteEnd?.kind : undefined;
  const routeEnd = session.pendingRouteEnd ?? localEnd;
  if (routeEnd === 'released') return 'ready';
  if (routeEnd === 'completed') return 'completed';
  return session.companyGuidance.executionStatus === 'IN_PROGRESS' ? 'active' : fallback;
}

export function formatRouteListUpdatedAt(date: Date): string {
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('.');
  const timePart = [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join(':');

  return `Last updated ${datePart} ${timePart}`;
}
