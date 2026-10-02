import { sanitizeDriverDiagnosticContext, type DriverDiagnosticContext } from '../domain/diagnostics/driverDiagnosticContract';
export type DiagnosticBinding = { accountOwnerHash: string; context: DriverDiagnosticContext; locationExpected: boolean | null };

/** Independently read account identity; never refresh, mutate, or use its token here. */
export async function restoreDiagnosticBinding(rawBinding: string | null, rawAccount: string | null, hashPhone: (phone: string) => Promise<string>): Promise<{ binding: DiagnosticBinding; phoneE164: string } | null> {
  if (!rawBinding || !rawAccount) return null;
  try {
    const saved = JSON.parse(rawBinding) as DiagnosticBinding;
    const account = JSON.parse(rawAccount) as { driverProfile?: { phoneE164?: unknown }; activeRouteSession?: { routePlanId?: unknown; startedAt?: unknown; updatedAt?: unknown; status?: unknown }; routeAccess?: { assignmentGeneration?: unknown } };
    const phone = account?.driverProfile?.phoneE164;
    if (typeof phone !== 'string' || !/^\+[1-9]\d{7,14}$/u.test(phone) || !/^[a-f0-9]{64}$/u.test(saved.accountOwnerHash) || await hashPhone(phone) !== saved.accountOwnerHash) return null;
    const route = account.activeRouteSession;
    const context = sanitizeDriverDiagnosticContext({
      ...saved.context,
      routePlanId: route?.routePlanId ?? null, sessionGeneration: route?.startedAt ?? route?.updatedAt ?? null,
      assignmentGeneration: route ? account.routeAccess?.assignmentGeneration ?? null : null,
    });
    if (!context) return null;
    return { binding: { accountOwnerHash: saved.accountOwnerHash, context, locationExpected: route?.status === 'active' && typeof route.startedAt === 'string' }, phoneE164: phone };
  } catch { return null; }
}

export function equalDiagnosticContext(left: DriverDiagnosticContext, right: DriverDiagnosticContext): boolean {
  return (['appVersion', 'versionCode', 'os', 'osVersion', 'deviceInstanceHash', 'routePlanId', 'sessionGeneration', 'assignmentGeneration'] as const)
    .every(key => (left[key] ?? null) === (right[key] ?? null));
}
