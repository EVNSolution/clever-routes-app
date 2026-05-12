import { getInitialAccessValidation, type DriverFlowState } from './driverFlow';

export type RouteAccessLookupInput = {
  routeContext: string;
  phoneE164: string;
};

export type RouteAccessCompanyGuidance = {
  companyDisplayName: string;
  deliveryDate: string;
  driverInstructions: string[];
  operatorSupportContact: string | null;
  pickupGuidance: string | null;
  routeName: string;
  shopDomain: string;
  timezone: string | null;
};

export type DriverAccessToken = {
  accessToken: string;
  expiresAt: string;
  tokenType: 'Bearer';
  ttlSeconds: number;
  use: 'consent_and_assigned_route';
};

export type RouteAccessLookupResult =
  | {
      status: 'INVITED';
      routeAccess: {
        nextState: 'consent_required';
        routeContext: string;
        routePlanId: string;
      };
      driverAccess: DriverAccessToken;
      companyGuidance: RouteAccessCompanyGuidance;
    }
  | { status: 'BLOCKED' | 'DISABLED' | 'NOT_FOUND' };

export type RouteAccessService = {
  lookupRouteAccess(input: RouteAccessLookupInput): Promise<RouteAccessLookupResult>;
};

export type RouteAccessSubmissionResult =
  | {
      kind: 'validation_error';
      message: string;
      reason: 'phone_invalid' | 'phone_required' | 'route_context_required';
    }
  | {
      kind: 'company_guidance';
      companyGuidance: RouteAccessCompanyGuidance;
      driverAccess: DriverAccessToken;
      flowState: Extract<DriverFlowState, 'company_context_confirmed'>;
      nextState: 'consent_required';
      routeAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }>['routeAccess'];
    }
  | {
      kind: 'denied';
      message: string;
      status: 'BLOCKED' | 'DISABLED' | 'NOT_FOUND';
    };

export type FetchLike = (
  input: string,
  init?: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
  },
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
  status?: number;
}>;

export const sampleInvitedRouteAccess: Extract<RouteAccessLookupResult, { status: 'INVITED' }> = {
  status: 'INVITED',
  routeAccess: {
    nextState: 'consent_required',
    routeContext: '11111111-1111-4111-8111-111111111111',
    routePlanId: '11111111-1111-4111-8111-111111111111',
  },
  companyGuidance: {
    companyDisplayName: 'Tomatono Toronto',
    deliveryDate: '2026-05-12',
    driverInstructions: ['Bring insulated bag'],
    operatorSupportContact: '+14165550000',
    pickupGuidance: 'Meet at dispatch desk by 9:00 AM',
    routeName: 'Tuesday AM Route',
    shopDomain: 'tomatono.myshopify.com',
    timezone: 'America/Toronto',
  },
  driverAccess: {
    accessToken: 'fixture-driver-access-token',
    expiresAt: '2026-05-12T06:55:00.000Z',
    tokenType: 'Bearer',
    ttlSeconds: 900,
    use: 'consent_and_assigned_route',
  },
};

export function createMockRouteAccessService(
  result: RouteAccessLookupResult = sampleInvitedRouteAccess,
): RouteAccessService {
  return {
    lookupRouteAccess: async () => result,
  };
}

export async function submitRouteAccess(
  input: RouteAccessLookupInput,
  service: RouteAccessService,
): Promise<RouteAccessSubmissionResult> {
  const routeContext = input.routeContext.trim();
  const phoneE164 = input.phoneE164.trim();
  const validation = getInitialAccessValidation({ routeContext, phoneE164 });

  if (!validation.ok) {
    return {
      kind: 'validation_error',
      message: getRouteAccessValidationMessage(validation.reason),
      reason: validation.reason,
    };
  }

  const lookup = await service.lookupRouteAccess({ routeContext, phoneE164 });
  if (lookup.status === 'INVITED') {
    return {
      kind: 'company_guidance',
      companyGuidance: lookup.companyGuidance,
      driverAccess: lookup.driverAccess,
      flowState: 'company_context_confirmed',
      nextState: lookup.routeAccess.nextState,
      routeAccess: lookup.routeAccess,
    };
  }

  return {
    kind: 'denied',
    message: getRouteAccessDeniedMessage(lookup.status),
    status: lookup.status,
  };
}

export function getRouteAccessValidationMessage(
  reason: 'phone_invalid' | 'phone_required' | 'route_context_required',
): string {
  switch (reason) {
    case 'route_context_required':
      return 'Enter the company route link or route code before phone lookup.';
    case 'phone_required':
      return 'Enter the driver phone number in E.164 format.';
    case 'phone_invalid':
      return 'Use E.164 phone format, for example +14165550123.';
  }
}

export function getRouteAccessDeniedMessage(status: 'BLOCKED' | 'DISABLED' | 'NOT_FOUND'): string {
  switch (status) {
    case 'NOT_FOUND':
      return 'Route code and phone did not match an active assignment. Check the company route link/code or contact dispatch.';
    case 'DISABLED':
      return 'This driver profile is inactive. Contact dispatch before continuing.';
    case 'BLOCKED':
      return 'This driver profile is blocked. Contact dispatch before continuing.';
  }
}

export function createRouteAccessApiClient(input: {
  baseUrl: string;
  fetchImpl?: FetchLike;
}): RouteAccessService {
  const baseUrl = input.baseUrl.replace(/\/$/u, '');
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  return {
    lookupRouteAccess: async (request) => {
      const response = await fetchImpl(`${baseUrl}/driver/route-access/lookup`, {
        body: JSON.stringify(request),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`Route access lookup failed with HTTP ${response.status ?? 'unknown'}`);
      }

      return readRouteAccessEnvelope(payload);
    },
  };
}

function readRouteAccessEnvelope(payload: unknown): RouteAccessLookupResult {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Invalid route access response');
  }

  const data = (payload as { data?: unknown }).data;
  if (!isRouteAccessLookupResult(data)) {
    throw new Error('Invalid route access response');
  }

  return data;
}

function isRouteAccessLookupResult(value: unknown): value is RouteAccessLookupResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const status = (value as { status?: unknown }).status;
  if (status === 'BLOCKED' || status === 'DISABLED' || status === 'NOT_FOUND') {
    return true;
  }

  if (status !== 'INVITED') {
    return false;
  }

  const routeAccess = (value as { routeAccess?: unknown }).routeAccess;
  const driverAccess = (value as { driverAccess?: unknown }).driverAccess;
  const companyGuidance = (value as { companyGuidance?: unknown }).companyGuidance;
  return isRouteAccess(routeAccess) && isDriverAccessToken(driverAccess) && isCompanyGuidance(companyGuidance);
}

function isRouteAccess(value: unknown): value is Extract<RouteAccessLookupResult, { status: 'INVITED' }>['routeAccess'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const routeAccess = value as Record<string, unknown>;
  return (
    routeAccess.nextState === 'consent_required' &&
    typeof routeAccess.routeContext === 'string' &&
    typeof routeAccess.routePlanId === 'string'
  );
}

function isCompanyGuidance(value: unknown): value is RouteAccessCompanyGuidance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const guidance = value as Record<string, unknown>;
  return (
    typeof guidance.companyDisplayName === 'string' &&
    typeof guidance.deliveryDate === 'string' &&
    Array.isArray(guidance.driverInstructions) &&
    guidance.driverInstructions.every((item) => typeof item === 'string') &&
    nullableString(guidance.operatorSupportContact) &&
    nullableString(guidance.pickupGuidance) &&
    typeof guidance.routeName === 'string' &&
    typeof guidance.shopDomain === 'string' &&
    nullableString(guidance.timezone)
  );
}

function isDriverAccessToken(value: unknown): value is DriverAccessToken {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const token = value as Record<string, unknown>;
  return (
    typeof token.accessToken === 'string' &&
    token.accessToken.trim() !== '' &&
    typeof token.expiresAt === 'string' &&
    token.expiresAt.trim() !== '' &&
    token.tokenType === 'Bearer' &&
    typeof token.ttlSeconds === 'number' &&
    Number.isFinite(token.ttlSeconds) &&
    token.ttlSeconds > 0 &&
    token.use === 'consent_and_assigned_route'
  );
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
