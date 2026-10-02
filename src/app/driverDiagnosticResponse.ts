import type { DriverDiagnosticResponse } from '../domain/diagnostics/driverDiagnosticContract';

export function parseDriverDiagnosticResponse(value: unknown): DriverDiagnosticResponse | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (
    !Array.isArray(response.acceptedDiagnosticIds)
    || !response.acceptedDiagnosticIds.every((id) => typeof id === 'string')
    || !Array.isArray(response.rejectedDiagnostics)
    || !response.rejectedDiagnostics.every(isDiagnosticRejection)
    || typeof response.serverReceivedAt !== 'string'
    || !Number.isFinite(Date.parse(response.serverReceivedAt))
  ) return null;
  return {
    acceptedDiagnosticIds: response.acceptedDiagnosticIds,
    rejectedDiagnostics: response.rejectedDiagnostics,
    serverReceivedAt: new Date(Date.parse(response.serverReceivedAt)).toISOString(),
  };
}

function isDiagnosticRejection(value: unknown): value is { code: string; diagnosticId: string } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof (value as { code?: unknown }).code === 'string'
    && typeof (value as { diagnosticId?: unknown }).diagnosticId === 'string';
}
