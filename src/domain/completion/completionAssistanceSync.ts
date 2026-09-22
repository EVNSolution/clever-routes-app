import { runBoundedAsyncOperation } from '../async/boundedAsyncOperation';
import {
  emptyCompletionAssistanceState,
  parseCompletionPolicy,
  reconcileCompletionRuns,
  type CompletionAssistanceState,
  type CompletionCandidate,
  type CompletionCommand,
  type CompletionRun,
  type CompletionRunContext,
  type CompletionSample,
  type CompletionVisit,
} from './completionAssistance';

export type CompletionAssistanceStore = {
  read(accountOwnerHash: string): Promise<CompletionAssistanceState>;
  remove(accountOwnerHash: string): Promise<void>;
  update(
    accountOwnerHash: string,
    mutate: (state: CompletionAssistanceState) => CompletionAssistanceState,
  ): Promise<CompletionAssistanceState>;
};

export type CompletionAssistanceRawStorage = {
  readCompletionAssistanceState(accountOwnerHash: string): Promise<string | null>;
  removeCompletionAssistanceState(accountOwnerHash: string): Promise<void>;
  updateCompletionAssistanceState(
    accountOwnerHash: string,
    mutate: (persistedState: string | null) => string,
  ): Promise<string>;
};

export type CompletionAssistanceFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

const COMPLETION_ASSISTANCE_CONTRACT_VERSION = 1;
const DEFAULT_SYNC_TIMEOUT_MS = 15_000;
const RESPONSE_DEADLINE_MS = 24 * 60 * 60 * 1_000;
const CANDIDATE_STATUSES = new Set([
  'awaiting_response', 'responded', 'inferred_completed', 'held', 'invalidated',
]);
const RESPONSES = new Set(['completed', 'failed', 'not_completed']);

export class CompletionAssistanceSyncRetryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CompletionAssistanceSyncRetryError';
  }
}

class CompletionAssistanceProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompletionAssistanceProtocolError';
  }
}

export function createCompletionAssistanceStore(
  storage: CompletionAssistanceRawStorage,
): CompletionAssistanceStore {
  return {
    read: async (accountOwnerHash) => parseStoredState(
      await storage.readCompletionAssistanceState(accountOwnerHash),
    ),
    remove: (accountOwnerHash) => storage.removeCompletionAssistanceState(accountOwnerHash),
    update: async (accountOwnerHash, mutate) => {
      const serialized = await storage.updateCompletionAssistanceState(accountOwnerHash, (raw) => {
        const current = parseStoredState(raw);
        const updated = mutate(current);
        if (!isCompletionAssistanceState(updated)) {
          throw new Error('Completion assistance mutation produced malformed state.');
        }
        return JSON.stringify(updated);
      });
      return parseStoredState(serialized);
    },
  };
}

export async function synchronizeCompletionAssistance(input: {
  accessToken: string;
  accountOwnerHash: string;
  baseUrl: string;
  fetchImpl?: CompletionAssistanceFetch;
  isCurrent?: () => boolean;
  signal?: AbortSignal;
  store: CompletionAssistanceStore;
  timeoutMs?: number;
  validateCurrent?: () => Promise<boolean>;
}): Promise<{ state: CompletionAssistanceState; supported: boolean }> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const endpoint = `${input.baseUrl.replace(/\/$/u, '')}/driver/completion-assistance`;
  const isCurrent = () => input.signal?.aborted !== true && input.isCurrent?.() !== false;
  const requireCurrent = () => {
    if (!isCurrent()) {
      throw Object.assign(new Error('Completion assistance synchronization lifecycle changed.'), { name: 'AbortError' });
    }
  };
  const requireCurrentAsync = async () => {
    requireCurrent();
    if (input.validateCurrent !== undefined && !await input.validateCurrent()) {
      throw Object.assign(new Error('Completion assistance persisted identity changed.'), { name: 'AbortError' });
    }
    requireCurrent();
  };
  const readCurrent = async () => {
    await requireCurrentAsync();
    const state = await input.store.read(input.accountOwnerHash);
    await requireCurrentAsync();
    return state;
  };
  const updateCurrent = async (
    mutate: (state: CompletionAssistanceState) => CompletionAssistanceState,
  ) => {
    await requireCurrentAsync();
    const state = await input.store.update(input.accountOwnerHash, (current) => {
      requireCurrent();
      return mutate(current);
    });
    await requireCurrentAsync();
    return state;
  };
  const request = async (method: 'GET' | 'POST', body?: unknown): Promise<{
    payload?: unknown;
    response: Response;
  }> => {
    await requireCurrentAsync();
    let result: { payload?: unknown; response: Response };
    try {
      result = await runBoundedAsyncOperation(async (signal) => {
        await requireCurrentAsync();
        const response = await fetchImpl(endpoint, {
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          cache: 'no-store',
          credentials: 'omit',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${input.accessToken}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          method,
          signal,
        });
        await requireCurrentAsync();
        if (!response.ok) return { response };
        let payload: unknown;
        try {
          await requireCurrentAsync();
          payload = await response.json() as unknown;
          await requireCurrentAsync();
        } catch (error) {
          if (isAbortError(error)) throw error;
          throw new CompletionAssistanceProtocolError(
            `Completion assistance ${method} response is not valid JSON: ${readErrorMessage(error)}`,
          );
        }
        return { payload, response };
      }, {
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        timeoutMs: input.timeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS,
      });
    } catch (error) {
      if (!isCurrent() || isAbortError(error) || error instanceof CompletionAssistanceProtocolError) throw error;
      throw new CompletionAssistanceSyncRetryError(
        `Completion assistance ${method} request did not complete; retry with the same command IDs.`,
        { cause: error },
      );
    }
    await requireCurrentAsync();
    return result;
  };
  const disableCapability = () => updateCurrent((state) => ({
    ...state,
    bufferedLocations: [],
    capability: 'unsupported',
    runs: [],
    visits: [],
  }));

  let state = await readCurrent();
  for (const queuedCommand of state.commands) {
    requireCurrent();
    const latest = await readCurrent();
    const command = latest.commands.find((item) => item.commandId === queuedCommand.commandId);
    if (command === undefined) continue;
    const { payload, response } = await request('POST', {
      command,
      contractVersion: COMPLETION_ASSISTANCE_CONTRACT_VERSION,
    });
    if (response.status === 404 || response.status === 501) {
      return { state: await disableCapability(), supported: false };
    }
    if (!response.ok) {
      throw new CompletionAssistanceSyncRetryError(
        `Completion assistance POST failed with HTTP ${response.status}; command was preserved for retry.`,
      );
    }
    const acknowledgement = parseCommandAcknowledgement(payload, command.commandId);
    requireAcknowledgementCandidateIdentity(command, acknowledgement.candidate);
    requireAcknowledgementReflectsCommand(command, acknowledgement);
    state = await updateCurrent((current) => applyCommandAcknowledgement(current, command, acknowledgement));
  }

  const { payload, response: snapshotResponse } = await request('GET');
  if (snapshotResponse.status === 404 || snapshotResponse.status === 501) {
    return { state: await disableCapability(), supported: false };
  }
  if (!snapshotResponse.ok) {
    throw new CompletionAssistanceSyncRetryError(
      `Completion assistance GET failed with HTTP ${snapshotResponse.status}; local state was preserved.`,
    );
  }
  const snapshot = parseServerSnapshot(payload);
  state = await updateCurrent((current) => {
    const withServerCandidates: CompletionAssistanceState = {
      ...current,
      capability: 'supported',
      candidates: mergeCandidates(current, snapshot.candidates),
    };
    return reconcileCompletionRuns(withServerCandidates, snapshot.runs, snapshot.runContexts);
  });
  return { state, supported: true };
}

type CommandAcknowledgement = {
  candidate?: CompletionCandidate;
  commandId: string;
  reason?: string;
  status: 'applied' | 'duplicate' | 'rejected';
};

function applyCommandAcknowledgement(
  state: CompletionAssistanceState,
  command: CompletionCommand,
  acknowledgement: CommandAcknowledgement,
): CompletionAssistanceState {
  if (!state.commands.some((item) => item.commandId === command.commandId)) return state;
  if (
    command.kind === 'response'
    && (acknowledgement.status === 'applied' || acknowledgement.status === 'duplicate')
    && acknowledgement.candidate === undefined
  ) {
    throw new CompletionAssistanceProtocolError(
      'Completion assistance response ACK requires an authoritative candidate.',
    );
  }
  if (
    command.kind === 'response'
    && acknowledgement.status === 'rejected'
    && acknowledgement.candidate === undefined
    && state.candidates.some((candidate) => candidate.candidateId === command.candidateId)
  ) {
    throw new CompletionAssistanceProtocolError(
      'Completion assistance rejected response ACK requires the current authoritative candidate.',
    );
  }
  const remainingCommands = state.commands.filter((item) => item.commandId !== command.commandId);
  const commandCandidateId = command.kind === 'candidate'
    ? command.candidate.candidateId
    : command.kind === 'response' ? command.candidateId : null;
  const hasLaterExplicitResponse = commandCandidateId !== null && remainingCommands.some((item) => (
    item.kind === 'response' && item.candidateId === commandCandidateId
  ));
  let candidates = state.candidates;
  if (acknowledgement.candidate !== undefined && !hasLaterExplicitResponse) {
    candidates = replaceAcknowledgedCandidate(candidates, acknowledgement.candidate);
  }
  if (acknowledgement.status === 'rejected' && !hasLaterExplicitResponse) {
    if (commandCandidateId !== null) {
      const reason = sanitizeReason(acknowledgement.reason);
      candidates = candidates.map((candidate) => candidate.candidateId === commandCandidateId && candidate.status !== 'invalidated'
        ? { ...candidate, holdReason: `server_rejected:${reason}`, status: 'held' }
        : candidate);
    }
  }
  return {
    ...state,
    candidates,
    commands: remainingCommands,
  };
}

function replaceAcknowledgedCandidate(
  candidates: readonly CompletionCandidate[],
  authoritative: CompletionCandidate,
): CompletionCandidate[] {
  const local = candidates.find((candidate) => candidate.candidateId === authoritative.candidateId);
  const replacement = local?.notified === true ? { ...authoritative, notified: true } : authoritative;
  return local === undefined
    ? [...candidates, replacement]
    : candidates.map((candidate) => candidate.candidateId === authoritative.candidateId ? replacement : candidate);
}

function requireAcknowledgementCandidateIdentity(
  command: CompletionCommand,
  candidate: CompletionCandidate | undefined,
): void {
  if (candidate === undefined) return;
  if (command.kind === 'return_intent') {
    throw new CompletionAssistanceProtocolError(
      'Completion assistance return-intent ACK unexpectedly included a candidate identity.',
    );
  }
  const expected = command.kind === 'candidate' ? command.candidate : command;
  if (
    candidate.candidateId !== expected.candidateId
    || candidate.runId !== expected.runId
    || candidate.routePlanId !== expected.routePlanId
    || candidate.assignmentGeneration !== expected.assignmentGeneration
    || candidate.expectedRouteVersionId !== expected.expectedRouteVersionId
    || candidate.deliveryStopId !== expected.deliveryStopId
  ) {
    throw new CompletionAssistanceProtocolError(
      'Completion assistance ACK candidate identity does not match the queued command.',
    );
  }
}

function requireAcknowledgementReflectsCommand(
  command: CompletionCommand,
  acknowledgement: CommandAcknowledgement,
): void {
  if (
    command.kind !== 'response'
    || (acknowledgement.status !== 'applied' && acknowledgement.status !== 'duplicate')
  ) return;
  const candidate = acknowledgement.candidate;
  if (
    candidate === undefined
    || candidate.status !== 'responded'
    || candidate.response !== command.response
    || candidate.responseAt !== command.occurredAt
    || candidate.revision <= command.expectedRevision
  ) {
    throw new CompletionAssistanceProtocolError(
      'Completion assistance response ACK authoritative candidate does not reflect the queued command.',
    );
  }
}

function mergeCandidates(
  state: CompletionAssistanceState,
  serverCandidates: readonly CompletionCandidate[],
): CompletionCandidate[] {
  const merged = new Map(state.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const queuedResponseIds = new Set(state.commands.flatMap((command) => (
    command.kind === 'response' ? [command.candidateId] : []
  )));
  for (const server of serverCandidates) {
    const local = merged.get(server.candidateId);
    const hasRejectedConflict = local?.status === 'held'
      && local.holdReason?.startsWith('server_rejected:') === true
      && server.status !== 'invalidated'
      && server.revision <= local.revision;
    if (hasRejectedConflict) continue;
    if (
      local === undefined
      || (!queuedResponseIds.has(server.candidateId) && server.revision > local.revision)
    ) {
      merged.set(server.candidateId, local?.notified === true ? { ...server, notified: true } : server);
      continue;
    }
    if (server.revision === local.revision && !queuedResponseIds.has(server.candidateId)) {
      merged.set(server.candidateId, {
        ...server,
        ...(local.notified === undefined ? {} : { notified: local.notified }),
        ...(local.response === undefined ? {} : { response: local.response }),
        ...(local.responseAt === undefined ? {} : { responseAt: local.responseAt }),
      });
    }
  }
  return [...merged.values()];
}

function parseStoredState(raw: string | null): CompletionAssistanceState {
  if (raw === null) return emptyCompletionAssistanceState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Persisted completion assistance state is malformed; evidence was preserved.');
  }
  if (isRecord(parsed) && typeof parsed.schemaVersion === 'number' && parsed.schemaVersion > 1) {
    throw new Error(`Persisted completion assistance state uses newer schema version ${parsed.schemaVersion}; downgrade is blocked.`);
  }
  if (!isCompletionAssistanceState(parsed)) {
    throw new Error('Persisted completion assistance state is malformed; evidence was preserved.');
  }
  return parsed;
}

function isCompletionAssistanceState(value: unknown): value is CompletionAssistanceState {
  return isRecord(value)
    && value.schemaVersion === 1
    && Array.isArray(value.runs) && value.runs.every(isCompletionRun)
    && Array.isArray(value.candidates) && value.candidates.every(isCompletionCandidate)
    && Array.isArray(value.commands) && value.commands.every(isCompletionCommand)
    && Array.isArray(value.visits) && value.visits.every(isCompletionVisit)
    && (value.capability === undefined || value.capability === 'supported' || value.capability === 'unsupported')
    && (value.bufferedLocations === undefined
      || (Array.isArray(value.bufferedLocations)
        && value.bufferedLocations.every(isBufferedLocations)
        && hasUniqueIdentity(value.bufferedLocations, false)))
    && (value.manualOutcomes === undefined
      || (Array.isArray(value.manualOutcomes)
        && value.manualOutcomes.every(isManualOutcome)
        && hasUniqueIdentity(value.manualOutcomes, true)))
    && (value.pendingReturnIntents === undefined
      || (Array.isArray(value.pendingReturnIntents)
        && value.pendingReturnIntents.every(isPendingReturnIntent)
        && hasUniqueIdentity(value.pendingReturnIntents, false)))
    && hasUniqueStrings(value.runs, 'runId')
    && hasUniqueStrings(value.candidates, 'candidateId')
    && hasUniqueStrings(value.commands, 'commandId');
}

function parseServerSnapshot(value: unknown): {
  candidates: CompletionCandidate[];
  runContexts: CompletionRunContext[];
  runs: CompletionRun[];
} {
  if (
    !isRecord(value)
    || value.contractVersion !== COMPLETION_ASSISTANCE_CONTRACT_VERSION
    || !isTimestamp(value.serverTime)
    || !Array.isArray(value.runs)
    || !value.runs.every(isServerCompletionRunStructure)
    || !Array.isArray(value.candidates)
    || !value.candidates.every(isServerCompletionCandidate)
  ) {
    throw new Error('Completion assistance server snapshot is malformed.');
  }
  if (!hasUniqueStrings(value.runs, 'runId')) {
    throw new CompletionAssistanceProtocolError('Completion assistance server snapshot has a duplicate run ID.');
  }
  if (!hasUniqueStrings(value.candidates, 'candidateId')) {
    throw new CompletionAssistanceProtocolError('Completion assistance server snapshot has a duplicate candidate ID.');
  }
  // An invalid or unknown policy disables detection for that run. Other valid
  // runs and already-created candidates remain usable for explicit responses.
  const runs = value.runs.filter(isServerCompletionRun);
  const runContexts = value.runs.map(toCompletionRunContext);
  return { candidates: value.candidates, runContexts, runs };
}

function parseCommandAcknowledgement(value: unknown, expectedCommandId: string): CommandAcknowledgement {
  if (
    !isRecord(value)
    || value.contractVersion !== COMPLETION_ASSISTANCE_CONTRACT_VERSION
    || !isNonEmptyString(value.commandId)
    || !['applied', 'duplicate', 'rejected'].includes(String(value.status))
    || (value.reason !== undefined && typeof value.reason !== 'string')
    || (value.candidate !== undefined && !isServerCompletionCandidate(value.candidate))
  ) {
    throw new Error('Completion assistance command ACK is malformed.');
  }
  if (value.commandId !== expectedCommandId) {
    throw new Error('Completion assistance command ACK command ID does not match.');
  }
  return {
    ...(value.candidate === undefined ? {} : { candidate: value.candidate }),
    commandId: value.commandId,
    ...(value.reason === undefined ? {} : { reason: value.reason }),
    status: value.status as CommandAcknowledgement['status'],
  };
}

function isCompletionRun(value: unknown): value is CompletionRun {
  return isCompletionRunStructure(value)
    && parseCompletionPolicy(value.policy) !== null;
}

function isServerCompletionRun(value: unknown): value is CompletionRun {
  return isCompletionRun(value) && hasCanonicalServerAssignmentIdentity(value);
}

type CompletionRunStructure = CompletionRunContext & { policy: unknown };

function isServerCompletionRunStructure(value: unknown): value is CompletionRunStructure {
  return isCompletionRunStructure(value) && hasCanonicalServerAssignmentIdentity(value);
}

function isCompletionRunStructure(value: unknown): value is CompletionRunStructure {
  return isRecord(value)
    && isNonEmptyString(value.runId)
    && isNonEmptyString(value.routePlanId)
    && isNonEmptyString(value.assignmentGeneration)
    && isNonEmptyString(value.expectedRouteVersionId)
    && optionalString(value.routeName)
    && Array.isArray(value.stops)
    && value.stops.every((stop) => isRecord(stop)
      && isNonEmptyString(stop.deliveryStopId)
      && isNonEmptyString(stop.status)
      && optionalString(stop.label)
      && (stop.manualResponse === undefined || isManualResponse(stop.manualResponse))
      && (stop.coordinates === null || isCoordinate(stop.coordinates)))
    && hasUniqueStrings(value.stops, 'deliveryStopId')
    && (value.trackingEndedAt === undefined || isTimestamp(value.trackingEndedAt));
}

function toCompletionRunContext(run: CompletionRunStructure): CompletionRunContext {
  return {
    assignmentGeneration: run.assignmentGeneration,
    expectedRouteVersionId: run.expectedRouteVersionId,
    ...(run.routeName === undefined ? {} : { routeName: run.routeName }),
    routePlanId: run.routePlanId,
    runId: run.runId,
    stops: run.stops,
    ...(run.trackingEndedAt === undefined ? {} : { trackingEndedAt: run.trackingEndedAt }),
  };
}

function isCompletionCandidate(value: unknown): value is CompletionCandidate {
  if (!isRecord(value)) return false;
  const status = value.status;
  const response = value.response;
  const temporalOrderValid = isTimestamp(value.arrivalAt)
    && isTimestamp(value.dwellCompletedAt)
    && isTimestamp(value.exitAt)
    && Date.parse(value.arrivalAt) <= Date.parse(value.dwellCompletedAt)
    && Date.parse(value.dwellCompletedAt) <= Date.parse(value.exitAt)
    && (value.responseDeadlineAt === undefined
      || (isTimestamp(value.responseDeadlineAt)
        && Date.parse(value.responseDeadlineAt) === Date.parse(value.exitAt) + RESPONSE_DEADLINE_MS))
    && (value.autoCompletedAt === undefined
      || (isTimestamp(value.autoCompletedAt)
        && value.responseDeadlineAt !== undefined
        && Date.parse(value.responseDeadlineAt) <= Date.parse(value.autoCompletedAt)));
  return isNonEmptyString(value.candidateId)
    && isNonEmptyString(value.runId)
    && isNonEmptyString(value.routePlanId)
    && isNonEmptyString(value.assignmentGeneration)
    && isNonEmptyString(value.expectedRouteVersionId)
    && isNonEmptyString(value.deliveryStopId)
    && optionalString(value.routeName)
    && optionalString(value.stopLabel)
    && temporalOrderValid
    && Array.isArray(value.evidence)
    && value.evidence.length > 0
    && value.evidence.every(isCompletionSample)
    && hasOrderedCandidateEvidence(value.evidence, value.arrivalAt, value.exitAt)
    && isNonEmptyString(value.policyVersion)
    && typeof status === 'string' && CANDIDATE_STATUSES.has(status)
    && Number.isInteger(value.revision) && Number(value.revision) >= 0
    && (response === undefined || (typeof response === 'string' && RESPONSES.has(response)))
    && (status !== 'responded' || (typeof response === 'string' && RESPONSES.has(response)))
    && (status !== 'responded' || isTimestamp(value.responseAt))
    && (status !== 'inferred_completed'
      || (isTimestamp(value.responseDeadlineAt) && isTimestamp(value.autoCompletedAt)))
    && (value.responseAt === undefined || isTimestamp(value.responseAt))
    && (value.responseDeadlineAt === undefined || isTimestamp(value.responseDeadlineAt))
    && (value.autoCompletedAt === undefined || isTimestamp(value.autoCompletedAt))
    && (value.holdReason === undefined || isNonEmptyString(value.holdReason))
    && (value.notified === undefined || typeof value.notified === 'boolean');
}

function isServerCompletionCandidate(value: unknown): value is CompletionCandidate {
  return isCompletionCandidate(value)
    && hasCanonicalServerAssignmentIdentity(value)
    && (value.status !== 'awaiting_response' || value.responseDeadlineAt !== undefined);
}

function isCompletionCommand(value: unknown): value is CompletionCommand {
  if (!isRecord(value) || !isNonEmptyString(value.commandId) || typeof value.kind !== 'string') return false;
  if (value.kind === 'candidate') return isCompletionCandidate(value.candidate) && isTimestamp(value.occurredAt);
  if (value.kind === 'response') {
    return isNonEmptyString(value.candidateId)
      && isNonEmptyString(value.runId)
      && isNonEmptyString(value.routePlanId)
      && isNonEmptyString(value.assignmentGeneration)
      && isNonEmptyString(value.expectedRouteVersionId)
      && isNonEmptyString(value.deliveryStopId)
      && typeof value.response === 'string' && RESPONSES.has(value.response)
      && isTimestamp(value.occurredAt)
      && Number.isInteger(value.expectedRevision) && Number(value.expectedRevision) >= 0
      && (value.previousResponseCommandId === undefined
        || (isNonEmptyString(value.previousResponseCommandId)
          && value.previousResponseCommandId !== value.commandId));
  }
  return value.kind === 'return_intent'
    && isNonEmptyString(value.runId)
    && isNonEmptyString(value.routePlanId)
    && isNonEmptyString(value.assignmentGeneration)
    && isNonEmptyString(value.expectedRouteVersionId)
    && isTimestamp(value.occurredAt);
}

function isCompletionVisit(value: unknown): value is CompletionVisit {
  return isRecord(value)
    && isNonEmptyString(value.runId)
    && isNonEmptyString(value.assignmentGeneration)
    && isNonEmptyString(value.deliveryStopId)
    && (value.stage === 'outside' || value.stage === 'dwelling')
    && typeof value.approached === 'boolean'
    && (value.lastOccurredAt === undefined || isTimestamp(value.lastOccurredAt))
    && (value.arrivalAt === undefined || isTimestamp(value.arrivalAt))
    && (value.dwellCompletedAt === undefined || isTimestamp(value.dwellCompletedAt))
    && Number.isInteger(value.dwellSampleCount) && Number(value.dwellSampleCount) >= 0
    && Array.isArray(value.evidence) && value.evidence.every(isCompletionSample)
    && typeof value.evidenceOverflow === 'boolean';
}

function isCompletionSample(value: unknown): value is CompletionSample {
  return isRecord(value)
    && isFiniteNumber(value.latitude) && value.latitude >= -90 && value.latitude <= 90
    && isFiniteNumber(value.longitude) && value.longitude >= -180 && value.longitude <= 180
    && isFiniteNumber(value.accuracyMeters) && value.accuracyMeters >= 0
    && isTimestamp(value.occurredAt);
}

function isCoordinate(value: unknown): value is { latitude: number; longitude: number } {
  return isRecord(value)
    && isFiniteNumber(value.latitude) && value.latitude >= -90 && value.latitude <= 90
    && isFiniteNumber(value.longitude) && value.longitude >= -180 && value.longitude <= 180;
}

function isManualResponse(value: unknown): boolean {
  return isRecord(value)
    && (value.response === 'completed' || value.response === 'failed')
    && isTimestamp(value.occurredAt);
}

function isBufferedLocations(value: unknown): boolean {
  return isAssignmentIdentity(value)
    && Array.isArray(value.samples)
    && value.samples.length > 0
    && value.samples.every(isCompletionSample);
}

function isManualOutcome(value: unknown): boolean {
  return isAssignmentIdentity(value)
    && isNonEmptyString(value.deliveryStopId)
    && (value.response === 'completed' || value.response === 'failed')
    && isTimestamp(value.occurredAt);
}

function isPendingReturnIntent(value: unknown): boolean {
  return isAssignmentIdentity(value) && isTimestamp(value.occurredAt);
}

function isAssignmentIdentity(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && isNonEmptyString(value.routePlanId)
    && isNonEmptyString(value.assignmentGeneration)
    && isNonEmptyString(value.expectedRouteVersionId);
}

function hasCanonicalServerAssignmentIdentity(value: unknown): boolean {
  return isRecord(value)
    && isCanonicalAssignmentGeneration(value.assignmentGeneration)
    && isUuid(value.expectedRouteVersionId);
}

function isCanonicalAssignmentGeneration(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value)) return false;
  try {
    return BigInt(value) <= 9_223_372_036_854_775_807n;
  } catch {
    return false;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function hasOrderedCandidateEvidence(
  evidence: unknown[],
  arrivalAt: unknown,
  exitAt: unknown,
): boolean {
  if (!isTimestamp(arrivalAt) || !isTimestamp(exitAt)) return false;
  const times = evidence.map((sample) => isRecord(sample) && isTimestamp(sample.occurredAt)
    ? Date.parse(sample.occurredAt)
    : Number.NaN);
  if (times.some((time) => !Number.isFinite(time))) return false;
  for (let index = 1; index < times.length; index += 1) {
    if (times[index]! <= times[index - 1]!) return false;
  }
  return times[0]! <= Date.parse(arrivalAt) && times[times.length - 1]! >= Date.parse(exitAt);
}

function sanitizeReason(reason: string | undefined): string {
  const normalized = reason?.trim().replace(/[^a-zA-Z0-9_.-]+/gu, '_').slice(0, 80);
  return normalized === undefined || normalized.length === 0 ? 'unspecified' : normalized;
}

function hasUniqueStrings(values: unknown[], key: string): boolean {
  const ids = values.map((value) => isRecord(value) ? value[key] : undefined);
  return ids.every((value) => typeof value === 'string') && new Set(ids).size === ids.length;
}

function hasUniqueIdentity(values: unknown[], includeStop: boolean): boolean {
  const identities = values.map((value) => {
    if (!isAssignmentIdentity(value)) return '';
    return [
      value.routePlanId,
      value.assignmentGeneration,
      value.expectedRouteVersionId,
      ...(includeStop && isNonEmptyString(value.deliveryStopId) ? [value.deliveryStopId] : []),
    ].join('|');
  });
  return identities.every((identity) => identity.length > 0) && new Set(identities).size === identities.length;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : 'unknown parse error';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
