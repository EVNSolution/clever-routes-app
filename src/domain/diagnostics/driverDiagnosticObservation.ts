import { DriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import type {
  DriverDiagnosticReasonCode,
  DriverDiagnosticSnapshot,
  DriverDiagnosticStage,
} from './driverDiagnosticContract';
import { DRIVER_DIAGNOSTIC_REASON_CODES } from './driverDiagnosticContract';

export type DriverDiagnosticOperation =
  | 'AUTH_REFRESH'
  | 'EVENT_SEND'
  | 'GPS_SEND'
  | 'PROOF_UPLOAD'
  | 'ROUTE_LOOKUP'
  | 'STORAGE_READ'
  | 'STORAGE_WRITE';

export type DriverDiagnosticObservationReasonCode = DriverDiagnosticReasonCode;

type DriverDiagnosticStatePatch = Partial<Pick<
  DriverDiagnosticSnapshot,
  'lifecycle' | 'locationPermission' | 'locationService' | 'locationTask' | 'network'
>> & {
  locationTaskExpected?: boolean | null;
};

export type DriverDiagnosticOperationMetadata = {
  clientEventId?: string;
  operation: DriverDiagnosticOperation;
  requestId?: string;
  routePlanId?: string;
  sessionGeneration?: string;
};

export type DriverDiagnosticOperationObservation = DriverDiagnosticOperationMetadata & {
  httpStatus?: number;
  kind: 'OPERATION';
  observedAt: string;
  phase: 'FAILED' | 'STARTED' | 'SUCCEEDED' | 'WATCHDOG_TIMEOUT';
  reasonCode?: DriverDiagnosticObservationReasonCode;
};

export type DriverDiagnosticStateObservation = {
  blocker?: {
    clientEventId?: string;
    httpStatus?: number;
    reasonCode: DriverDiagnosticObservationReasonCode;
    requestId?: string;
    routePlanId?: string;
    sessionGeneration?: string;
    stage: DriverDiagnosticStage;
  };
  callbackAt?: string;
  clearStage?: DriverDiagnosticStage;
  clearReasonCodes?: readonly DriverDiagnosticReasonCode[];
  collectedAt?: string;
  kind: 'STATE';
  observedAt: string;
  patch?: DriverDiagnosticStatePatch;
  persistedAt?: string;
  sendAcknowledgedAt?: string;
  sendAttemptAt?: string;
};

export type DriverDiagnosticObservation =
  | DriverDiagnosticOperationObservation
  | DriverDiagnosticStateObservation;

export type DriverDiagnosticObservationInput =
  | DriverDiagnosticOperationMetadata & {
      httpStatus?: number;
      kind: 'OPERATION';
      phase: DriverDiagnosticOperationObservation['phase'];
      reasonCode?: DriverDiagnosticObservationReasonCode;
    }
  | Omit<DriverDiagnosticStateObservation, 'observedAt'>;

export type DriverDiagnosticObserver = (
  observation: DriverDiagnosticObservation,
) => Promise<void> | void;

export type DriverDiagnosticEmitter = (input: DriverDiagnosticObservationInput) => void;
export type DriverDiagnosticOperationObserver = <T>(
  metadata: DriverDiagnosticOperationMetadata,
  operation: () => Promise<T>,
) => Promise<T>;

type DriverDiagnosticObserverRuntime = {
  clearTimeout: (handle: unknown) => void;
  now: () => Date;
  observer: DriverDiagnosticObserver | null;
  requestIdFactory: () => string;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  version: number;
  watchdogMs: number;
};

const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const STRICT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SESSION_GENERATION_PATTERN = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const ISO_TIMESTAMP_MAX_LENGTH = 40;
const DEFAULT_WATCHDOG_MS = 15_000;
const REASON_CODES = new Set<string>(DRIVER_DIAGNOSTIC_REASON_CODES);
const STAGES = new Set<string>(['AUTH', 'LOCATION', 'PROCESSING', 'ROUTE', 'STORAGE', 'TRANSPORT']);
const LIFECYCLES = new Set<string>(['BACKGROUND', 'FOREGROUND', 'INACTIVE', 'UNKNOWN']);
const NETWORK_STATES = new Set<string>(['OFFLINE', 'ONLINE', 'UNKNOWN']);
const LOCATION_PERMISSIONS = new Set<string>(['DENIED', 'GRANTED_ALWAYS', 'GRANTED_FOREGROUND', 'UNKNOWN']);
const LOCATION_SERVICES = new Set<string>(['DISABLED', 'ENABLED', 'UNKNOWN']);
const LOCATION_TASK_STATES = new Set<string>(['ERROR', 'EXPECTED', 'STARTED', 'STOPPED', 'UNKNOWN']);

let fallbackUuidSequence = 0;

function createFallbackUuid(): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  const sequence = fallbackUuidSequence = (fallbackUuidSequence + 1) & 0xffff;
  bytes[0] = (bytes[0] ?? 0) ^ (sequence >>> 8);
  bytes[1] = (bytes[1] ?? 0) ^ (sequence & 0xff);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let runtime: DriverDiagnosticObserverRuntime = createDefaultRuntime(0, null);

function createDefaultRuntime(version: number, observer: DriverDiagnosticObserver | null): DriverDiagnosticObserverRuntime {
  return {
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    now: () => new Date(),
    observer,
    requestIdFactory: createFallbackUuid,
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    version,
    watchdogMs: DEFAULT_WATCHDOG_MS,
  };
}

export function installDriverDiagnosticObserver(
  observer: DriverDiagnosticObserver | null,
  options?: Partial<Pick<
    DriverDiagnosticObserverRuntime,
    'clearTimeout' | 'now' | 'requestIdFactory' | 'setTimeout' | 'watchdogMs'
  >>,
): void {
  const defaults = createDefaultRuntime(runtime.version + 1, observer);
  runtime = { ...defaults, ...options, observer, version: defaults.version };
}

export function createDriverDiagnosticRequestId(): string {
  const requestId = runtime.requestIdFactory();
  return STRICT_UUID_PATTERN.test(requestId) ? requestId.toLowerCase() : createFallbackUuid();
}

export function emitDriverDiagnosticObservation(input: DriverDiagnosticObservationInput): void {
  emitToCapturedRuntime(runtime, input);
}

export function captureDriverDiagnosticEmitter(): DriverDiagnosticEmitter {
  const capturedRuntime = runtime;
  return (input) => emitToCapturedRuntime(capturedRuntime, input);
}

export function captureDriverDiagnosticOperationObserver(): DriverDiagnosticOperationObserver {
  const capturedRuntime = runtime;
  return <T>(metadata: DriverDiagnosticOperationMetadata, operation: () => Promise<T>) => (
    observeDriverDiagnosticOperationWithRuntime(capturedRuntime, metadata, operation)
  );
}

export function captureDriverDiagnosticOperationObserverForOwner(
  expectedAccountOwnerHash: string,
  currentAccountOwnerHash: string | null,
): DriverDiagnosticOperationObserver {
  if (expectedAccountOwnerHash !== currentAccountOwnerHash) {
    return async <T>(_metadata: DriverDiagnosticOperationMetadata, operation: () => Promise<T>) => (
      Promise.resolve().then(operation)
    );
  }
  return captureDriverDiagnosticOperationObserver();
}

export async function observeDriverDiagnosticOperation<T>(
  metadata: DriverDiagnosticOperationMetadata,
  operation: () => Promise<T>,
): Promise<T> {
  return observeDriverDiagnosticOperationWithRuntime(runtime, metadata, operation);
}

async function observeDriverDiagnosticOperationWithRuntime<T>(
  capturedRuntime: DriverDiagnosticObserverRuntime,
  metadata: DriverDiagnosticOperationMetadata,
  operation: () => Promise<T>,
): Promise<T> {
  if (runtime.version !== capturedRuntime.version) {
    return Promise.resolve().then(operation);
  }
  const safeMetadata = sanitizeOperationMetadata(metadata);
  emitToCapturedRuntime(capturedRuntime, {
    ...safeMetadata,
    kind: 'OPERATION',
    phase: 'STARTED',
  });
  const watchdogHandle = capturedRuntime.setTimeout(() => {
    if (runtime.version !== capturedRuntime.version) return;
    emitToCapturedRuntime(capturedRuntime, {
      ...safeMetadata,
      kind: 'OPERATION',
      phase: 'WATCHDOG_TIMEOUT',
      reasonCode: safeMetadata.operation === 'AUTH_REFRESH'
        ? 'AUTH_REFRESH_TIMEOUT'
        : safeMetadata.operation === 'STORAGE_WRITE' || safeMetadata.operation === 'STORAGE_READ'
          ? 'STORAGE_OPERATION_TIMEOUT'
          : 'OPERATION_TIMEOUT',
    });
  }, capturedRuntime.watchdogMs);

  try {
    const result = await Promise.resolve().then(operation);
    capturedRuntime.clearTimeout(watchdogHandle);
    if (runtime.version === capturedRuntime.version) {
      emitToCapturedRuntime(capturedRuntime, {
        ...safeMetadata,
        kind: 'OPERATION',
        phase: 'SUCCEEDED',
      });
    }
    return result;
  } catch (error) {
    capturedRuntime.clearTimeout(watchdogHandle);
    if (runtime.version === capturedRuntime.version) {
      emitToCapturedRuntime(capturedRuntime, {
        ...safeMetadata,
        ...(safeMetadata.operation === 'STORAGE_WRITE'
          ? { reasonCode: 'STORAGE_WRITE_FAILED' as const }
          : safeMetadata.operation === 'STORAGE_READ'
            ? { reasonCode: 'STORAGE_READ_FAILED' as const }
            : classifyDriverDiagnosticError(error)),
        kind: 'OPERATION',
        phase: 'FAILED',
      });
    }
    throw error;
  }
}

function emitToCapturedRuntime(
  capturedRuntime: DriverDiagnosticObserverRuntime,
  input: DriverDiagnosticObservationInput,
): void {
  const observer = capturedRuntime.observer;
  if (observer === null || runtime.version !== capturedRuntime.version) return;
  const observation = sanitizeObservation(input, capturedRuntime.now());
  if (observation === null) return;
  try {
    const result = observer(observation);
    if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
  } catch {
    // Diagnostics are deliberately isolated from business behavior.
  }
}

function sanitizeObservation(
  input: DriverDiagnosticObservationInput,
  now: Date,
): DriverDiagnosticObservation | null {
  const observedAt = now.toISOString();
  if (input.kind === 'OPERATION') {
    return {
      ...sanitizeOperationMetadata(input),
      ...(safeHttpStatus(input.httpStatus) === undefined ? {} : { httpStatus: input.httpStatus }),
      kind: 'OPERATION',
      observedAt,
      phase: input.phase,
      ...(input.reasonCode === undefined || !REASON_CODES.has(input.reasonCode) ? {} : { reasonCode: input.reasonCode }),
    };
  }

  const patch = sanitizeStatePatch(input.patch);
  const blocker = sanitizeBlocker(input.blocker);
  return {
    ...(blocker === undefined ? {} : { blocker }),
    ...(safeTimestamp(input.callbackAt) === undefined ? {} : { callbackAt: safeTimestamp(input.callbackAt) }),
    ...(input.clearStage === undefined ? {} : { clearStage: input.clearStage }),
    ...(sanitizeReasonCodes(input.clearReasonCodes).length === 0
      ? {}
      : { clearReasonCodes: sanitizeReasonCodes(input.clearReasonCodes) }),
    ...(safeTimestamp(input.collectedAt) === undefined ? {} : { collectedAt: safeTimestamp(input.collectedAt) }),
    kind: 'STATE',
    observedAt,
    ...(patch === undefined ? {} : { patch }),
    ...(safeTimestamp(input.persistedAt) === undefined ? {} : { persistedAt: safeTimestamp(input.persistedAt) }),
    ...(safeTimestamp(input.sendAcknowledgedAt) === undefined ? {} : { sendAcknowledgedAt: safeTimestamp(input.sendAcknowledgedAt) }),
    ...(safeTimestamp(input.sendAttemptAt) === undefined ? {} : { sendAttemptAt: safeTimestamp(input.sendAttemptAt) }),
  };
}

function sanitizeReasonCodes(
  reasonCodes: readonly DriverDiagnosticReasonCode[] | undefined,
): readonly DriverDiagnosticReasonCode[] {
  if (reasonCodes === undefined) return [];
  return [...new Set(reasonCodes.filter((reasonCode) => REASON_CODES.has(reasonCode)))].slice(0, 10);
}

function sanitizeOperationMetadata(metadata: DriverDiagnosticOperationMetadata): DriverDiagnosticOperationMetadata {
  return {
    ...(safeId(metadata.clientEventId) === undefined ? {} : { clientEventId: metadata.clientEventId }),
    operation: metadata.operation,
    ...(safeRequestId(metadata.requestId) === undefined ? {} : { requestId: metadata.requestId?.toLowerCase() }),
    ...(safeId(metadata.routePlanId) === undefined ? {} : { routePlanId: metadata.routePlanId }),
    ...(safeSessionGeneration(metadata.sessionGeneration) === undefined ? {} : { sessionGeneration: metadata.sessionGeneration }),
  };
}

function sanitizeBlocker(blocker: DriverDiagnosticStateObservation['blocker']): DriverDiagnosticStateObservation['blocker'] | undefined {
  if (blocker === undefined || !REASON_CODES.has(blocker.reasonCode) || !STAGES.has(blocker.stage)) return undefined;
  return {
    ...(safeId(blocker.clientEventId) === undefined ? {} : { clientEventId: blocker.clientEventId }),
    ...(safeHttpStatus(blocker.httpStatus) === undefined ? {} : { httpStatus: blocker.httpStatus }),
    reasonCode: blocker.reasonCode,
    ...(safeRequestId(blocker.requestId) === undefined ? {} : { requestId: blocker.requestId?.toLowerCase() }),
    ...(safeId(blocker.routePlanId) === undefined ? {} : { routePlanId: blocker.routePlanId }),
    ...(safeSessionGeneration(blocker.sessionGeneration) === undefined ? {} : { sessionGeneration: blocker.sessionGeneration }),
    stage: blocker.stage,
  };
}

function sanitizeStatePatch(patch: DriverDiagnosticStateObservation['patch']): DriverDiagnosticStateObservation['patch'] | undefined {
  if (patch === undefined) return undefined;
  return {
    ...(patch.lifecycle === undefined || !LIFECYCLES.has(patch.lifecycle) ? {} : { lifecycle: patch.lifecycle }),
    ...(patch.locationPermission === undefined || !LOCATION_PERMISSIONS.has(patch.locationPermission) ? {} : { locationPermission: patch.locationPermission }),
    ...(patch.locationService === undefined || !LOCATION_SERVICES.has(patch.locationService) ? {} : { locationService: patch.locationService }),
    ...(patch.locationTask === undefined || !LOCATION_TASK_STATES.has(patch.locationTask) ? {} : { locationTask: patch.locationTask }),
    ...(patch.locationTaskExpected === undefined ? {} : { locationTaskExpected: patch.locationTaskExpected }),
    ...(patch.network === undefined || !NETWORK_STATES.has(patch.network) ? {} : { network: patch.network }),
  };
}

function safeId(value: string | undefined): string | undefined {
  return typeof value === 'string' && SAFE_ID_PATTERN.test(value) ? value : undefined;
}

function safeRequestId(value: string | undefined): string | undefined {
  return typeof value === 'string' && STRICT_UUID_PATTERN.test(value) ? value : undefined;
}

function safeSessionGeneration(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (SESSION_GENERATION_PATTERN.test(value)) return value;
  return value.length <= ISO_TIMESTAMP_MAX_LENGTH && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function safeTimestamp(value: string | undefined): string | undefined {
  if (typeof value !== 'string' || value.length > ISO_TIMESTAMP_MAX_LENGTH) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function safeHttpStatus(value: number | undefined): number | undefined {
  return Number.isInteger(value) && (value ?? 0) >= 100 && (value ?? 0) <= 599 ? value : undefined;
}

function classifyDriverDiagnosticError(error: unknown): {
  httpStatus?: number;
  reasonCode: DriverDiagnosticObservationReasonCode;
} {
  if (error instanceof DriverApiHttpError) {
    if (error.code === 'ROUTE_NOT_IN_PROGRESS') {
      return { ...(typeof error.status === 'number' ? { httpStatus: error.status } : {}), reasonCode: 'ROUTE_NOT_IN_PROGRESS' };
    }
    if (error.code === 'SESSION_MISMATCH') {
      return { ...(typeof error.status === 'number' ? { httpStatus: error.status } : {}), reasonCode: 'SESSION_MISMATCH' };
    }
    if (error.code === 'ROUTE_MISMATCH') {
      return { ...(typeof error.status === 'number' ? { httpStatus: error.status } : {}), reasonCode: 'ROUTE_MISMATCH' };
    }
    if (error.code === 'ROUTE_ACCESS_REVOKED') {
      return { ...(typeof error.status === 'number' ? { httpStatus: error.status } : {}), reasonCode: 'ROUTE_ACCESS_REVOKED' };
    }
    if (error.status === 401) return { httpStatus: 401, reasonCode: 'HTTP_UNAUTHORIZED' };
    if (error.status === 403) return { httpStatus: 403, reasonCode: 'HTTP_FORBIDDEN' };
    if (error.status === 429) return { httpStatus: 429, reasonCode: 'HTTP_RATE_LIMITED' };
    if (typeof error.status === 'number' && error.status >= 500) return { httpStatus: error.status, reasonCode: 'HTTP_SERVER_ERROR' };
    if (typeof error.status === 'number') return { httpStatus: error.status, reasonCode: 'HTTP_CLIENT_ERROR' };
    return { reasonCode: 'HTTP_INVALID_RESPONSE' };
  }

  if (isKnownAbortError(error)) return { reasonCode: 'REQUEST_ABORTED' };
  if (isKnownTimeoutError(error)) return { reasonCode: 'HTTP_TIMEOUT' };
  if (isKnownInvalidResponseError(error)) return { reasonCode: 'HTTP_INVALID_RESPONSE' };
  if (error instanceof Error && error.name === 'ProofMediaRejectedError') {
    return { httpStatus: 422, reasonCode: 'HTTP_CLIENT_ERROR' };
  }
  if (error instanceof SyntaxError) return { reasonCode: 'HTTP_INVALID_RESPONSE' };
  return { reasonCode: 'NETWORK_REQUEST_FAILED' };
}

function isKnownAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'Proof media upload aborted');
}

function isKnownTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === 'Network request timed out';
}

function isKnownInvalidResponseError(error: unknown): boolean {
  return error instanceof Error && /^(?:Invalid driver auth|Invalid driver event|Invalid proof media upload|Invalid route access) response$/u.test(error.message);
}
