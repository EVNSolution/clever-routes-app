export type CompletionPolicy = {
  version: string;
  maxAccuracyMeters: number;
  enterRadiusMeters: number;
  exitRadiusMeters: number;
  dwellMs: number;
  maxGapMs: number;
  minDwellSamples: number;
  ambiguityRadiusMeters: number;
};

export type CompletionSample = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  occurredAt: string;
};

export type CompletionRun = {
  runId: string;
  routePlanId: string;
  assignmentGeneration: string;
  expectedRouteVersionId: string;
  routeName?: string;
  policy: CompletionPolicy;
  stops: {
    deliveryStopId: string;
    coordinates: { latitude: number; longitude: number } | null;
    status: string;
    label?: string;
    manualResponse?: {
      response: 'completed' | 'failed';
      occurredAt: string;
    };
  }[];
  trackingEndedAt?: string;
};

export type CompletionCandidate = {
  candidateId: string;
  runId: string;
  routePlanId: string;
  assignmentGeneration: string;
  expectedRouteVersionId: string;
  deliveryStopId: string;
  routeName?: string;
  stopLabel?: string;
  arrivalAt: string;
  dwellCompletedAt: string;
  exitAt: string;
  evidence: CompletionSample[];
  policyVersion: string;
  status: 'awaiting_response' | 'responded' | 'inferred_completed' | 'held' | 'invalidated';
  revision: number;
  response?: 'completed' | 'failed' | 'not_completed';
  responseAt?: string;
  responseDeadlineAt?: string;
  autoCompletedAt?: string;
  holdReason?: string;
  notified?: boolean;
};

export type CompletionCommand =
  | {
      kind: 'candidate';
      commandId: string;
      candidate: CompletionCandidate;
      occurredAt: string;
    }
  | {
      kind: 'response';
      commandId: string;
      candidateId: string;
      runId: string;
      routePlanId: string;
      assignmentGeneration: string;
      expectedRouteVersionId: string;
      deliveryStopId: string;
      response: 'completed' | 'failed' | 'not_completed';
      occurredAt: string;
      expectedRevision: number;
    }
  | {
      kind: 'return_intent';
      commandId: string;
      runId: string;
      routePlanId: string;
      assignmentGeneration: string;
      expectedRouteVersionId: string;
      occurredAt: string;
    };

export type CompletionVisit = {
  runId: string;
  assignmentGeneration: string;
  deliveryStopId: string;
  stage: 'outside' | 'dwelling';
  approached: boolean;
  lastOccurredAt?: string;
  arrivalAt?: string;
  dwellCompletedAt?: string;
  dwellSampleCount: number;
  evidence: CompletionSample[];
  evidenceOverflow: boolean;
};

export type CompletionAssignmentIdentity = {
  routePlanId: string;
  assignmentGeneration: string;
  expectedRouteVersionId: string;
};

export type CompletionBufferedLocations = CompletionAssignmentIdentity & {
  samples: CompletionSample[];
};

export type CompletionManualOutcome = CompletionAssignmentIdentity & {
  deliveryStopId: string;
  response: 'completed' | 'failed';
  occurredAt: string;
};

export type CompletionPendingReturnIntent = CompletionAssignmentIdentity & {
  occurredAt: string;
};

export type CompletionAssistanceState = {
  schemaVersion: 1;
  capability?: 'supported' | 'unsupported';
  runs: CompletionRun[];
  candidates: CompletionCandidate[];
  commands: CompletionCommand[];
  visits: CompletionVisit[];
  bufferedLocations?: CompletionBufferedLocations[];
  manualOutcomes?: CompletionManualOutcome[];
  pendingReturnIntents?: CompletionPendingReturnIntent[];
};

const POLICY_KEYS = [
  'ambiguityRadiusMeters',
  'dwellMs',
  'enterRadiusMeters',
  'exitRadiusMeters',
  'maxAccuracyMeters',
  'maxGapMs',
  'minDwellSamples',
  'version',
] as const;
const MAX_EVIDENCE_SAMPLES = 64;
const MAX_BUFFERED_IDENTITIES = 2;
const MAX_BUFFERED_SAMPLES = 120;
const MAX_BUFFERED_AGE_MS = 20 * 60 * 1_000;
const MAX_MANUAL_OUTCOME_IDENTITIES = 2;
const MAX_PENDING_RETURN_IDENTITIES = 2;
const FUTURE_SAMPLE_TOLERANCE_MS = 5 * 60 * 1_000;
const DETECTABLE_STOP_STATUSES = new Set(['PENDING', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED']);

export function emptyCompletionAssistanceState(): CompletionAssistanceState {
  return { schemaVersion: 1, runs: [], candidates: [], commands: [], visits: [] };
}

export function parseCompletionPolicy(value: unknown): CompletionPolicy | null {
  if (!isRecord(value) || Object.keys(value).sort().join('|') !== [...POLICY_KEYS].sort().join('|')) {
    return null;
  }

  const version = value.version;
  const maxAccuracyMeters = value.maxAccuracyMeters;
  const enterRadiusMeters = value.enterRadiusMeters;
  const exitRadiusMeters = value.exitRadiusMeters;
  const dwellMs = value.dwellMs;
  const maxGapMs = value.maxGapMs;
  const minDwellSamples = value.minDwellSamples;
  const ambiguityRadiusMeters = value.ambiguityRadiusMeters;

  if (
    typeof version !== 'string'
    || version.trim().length === 0
    || !isPositiveFinite(maxAccuracyMeters)
    || !isPositiveFinite(enterRadiusMeters)
    || !isPositiveFinite(exitRadiusMeters)
    || exitRadiusMeters <= enterRadiusMeters
    || maxAccuracyMeters >= enterRadiusMeters
    || !isPositiveFinite(dwellMs)
    || !isPositiveFinite(maxGapMs)
    || maxGapMs > dwellMs
    || !isBoundedSampleCount(minDwellSamples)
    || !isPositiveFinite(ambiguityRadiusMeters)
    || ambiguityRadiusMeters < enterRadiusMeters
  ) {
    return null;
  }

  return {
    version,
    maxAccuracyMeters,
    enterRadiusMeters,
    exitRadiusMeters,
    dwellMs,
    maxGapMs,
    minDwellSamples,
    ambiguityRadiusMeters,
  };
}

export function reconcileCompletionRuns(
  state: CompletionAssistanceState,
  runs: CompletionRun[],
): CompletionAssistanceState {
  const previousRunById = new Map(state.runs.map((item) => [item.runId, item]));
  const manualOutcomes = trimManualOutcomes((state.manualOutcomes ?? []).filter((outcome) => (
    !runs.some((run) => sameIdentity(run, outcome)
      && run.stops.some((stop) => stop.deliveryStopId === outcome.deliveryStopId
        && !DETECTABLE_STOP_STATUSES.has(normalizeStatus(stop.status))))
  )));
  const activeRunIndexByRoute = new Map<string, number>();
  runs.forEach((run, index) => {
    if (run.trackingEndedAt === undefined) {
      activeRunIndexByRoute.set(run.routePlanId, index);
    }
  });
  const reconciledRuns = runs
    .filter((run, index) => run.trackingEndedAt !== undefined || activeRunIndexByRoute.get(run.routePlanId) === index)
    .map((run) => {
      const previous = previousRunById.get(run.runId);
      const canPreserveLocalRunState = previous !== undefined
        && previous.assignmentGeneration === run.assignmentGeneration
        && previous.expectedRouteVersionId === run.expectedRouteVersionId;
      return copyRun({
        ...run,
        ...(canPreserveLocalRunState && run.trackingEndedAt === undefined && previous?.trackingEndedAt !== undefined
          ? { trackingEndedAt: previous.trackingEndedAt }
          : {}),
        stops: run.stops.map((stop) => {
          const previousStop = canPreserveLocalRunState
            ? previous.stops.find((item) => item.deliveryStopId === stop.deliveryStopId)
            : undefined;
          const canOverlayPendingManual = DETECTABLE_STOP_STATUSES.has(normalizeStatus(stop.status));
          const pendingManualOutcome = canOverlayPendingManual
            ? manualOutcomes.find((outcome) => sameIdentity(run, outcome)
              && outcome.deliveryStopId === stop.deliveryStopId)
            : undefined;
          const manualResponse = stop.manualResponse
            ?? (canOverlayPendingManual ? previousStop?.manualResponse : undefined)
            ?? (pendingManualOutcome === undefined
              ? undefined
              : { response: pendingManualOutcome.response, occurredAt: pendingManualOutcome.occurredAt });
          return manualResponse === undefined
            ? stop
            : {
                ...stop,
                manualResponse,
                status: manualResponse.response === 'completed' ? 'DELIVERED' : 'FAILED',
              };
        }),
      });
    });
  const currentRunById = new Map(reconciledRuns.map((item) => [item.runId, item]));
  const candidates = state.candidates.map((candidate) => {
    if (candidate.status === 'invalidated') {
      return candidate;
    }
    const currentRun = currentRunById.get(candidate.runId);
    if (currentRun === undefined) {
      return invalidateCandidate(candidate, 'run_removed');
    }
    if (currentRun.assignmentGeneration !== candidate.assignmentGeneration) {
      return invalidateCandidate(candidate, 'assignment_changed');
    }
    if (currentRun.expectedRouteVersionId !== candidate.expectedRouteVersionId) {
      return invalidateCandidate(candidate, 'route_version_changed');
    }
    const currentStop = currentRun.stops.find((stop) => stop.deliveryStopId === candidate.deliveryStopId);
    if (currentStop === undefined) {
      return invalidateCandidate(candidate, 'stop_removed');
    }
    if (
      !DETECTABLE_STOP_STATUSES.has(normalizeStatus(currentStop.status))
      && candidate.status !== 'responded'
      && candidate.status !== 'inferred_completed'
    ) {
      return invalidateCandidate(candidate, 'stop_terminal');
    }
    return candidate;
  });

  const visits = state.visits.filter((visit) => {
    const currentRun = currentRunById.get(visit.runId);
    const previousRun = previousRunById.get(visit.runId);
    if (
      currentRun === undefined
      || currentRun.assignmentGeneration !== visit.assignmentGeneration
      || previousRun?.assignmentGeneration !== currentRun.assignmentGeneration
      || previousRun?.expectedRouteVersionId !== currentRun.expectedRouteVersionId
      || !samePolicy(previousRun.policy, currentRun.policy)
    ) {
      return false;
    }
    const currentStop = currentRun.stops.find((stop) => stop.deliveryStopId === visit.deliveryStopId);
    const previousStop = previousRun.stops.find((stop) => stop.deliveryStopId === visit.deliveryStopId);
    return currentStop !== undefined
      && previousStop !== undefined
      && currentStop.coordinates !== null
      && isValidCoordinate(currentStop.coordinates)
      && sameCoordinates(previousStop.coordinates, currentStop.coordinates)
      && DETECTABLE_STOP_STATUSES.has(normalizeStatus(currentStop.status));
  });

  let reconciled: CompletionAssistanceState = {
    ...state,
    runs: reconciledRuns,
    candidates,
    visits,
    ...(manualOutcomes.length === 0 ? { manualOutcomes: undefined } : { manualOutcomes }),
  };
  const bufferedLocations = state.bufferedLocations ?? [];
  for (const buffered of bufferedLocations) {
    const matchingRun = reconciledRuns.find((run) => (
      run.trackingEndedAt === undefined && sameIdentity(run, buffered)
    ));
    if (matchingRun !== undefined) {
      reconciled = observeCompletionLocations(reconciled, buffered.routePlanId, buffered.samples);
    }
  }
  const remainingBuffers = bufferedLocations.filter((buffered) => {
    const activeRunForRoute = reconciledRuns.find((run) => (
      run.routePlanId === buffered.routePlanId && run.trackingEndedAt === undefined
    ));
    return activeRunForRoute === undefined;
  });
  let completed: CompletionAssistanceState = {
    ...reconciled,
    ...(remainingBuffers.length === 0
      ? { bufferedLocations: undefined }
      : { bufferedLocations: remainingBuffers.slice(-MAX_BUFFERED_IDENTITIES) }),
  };
  const pendingReturnIntents = state.pendingReturnIntents ?? [];
  for (const pending of pendingReturnIntents) {
    if (reconciledRuns.some((run) => sameIdentity(run, pending))) {
      completed = recordCompletionReturnIntent(completed, pending.routePlanId, pending.occurredAt, {
        assignmentGeneration: pending.assignmentGeneration,
        expectedRouteVersionId: pending.expectedRouteVersionId,
      });
    }
  }
  const remainingReturnIntents = pendingReturnIntents.filter((pending) => (
    !reconciledRuns.some((run) => sameIdentity(run, pending))
    && !reconciledRuns.some((run) => run.routePlanId === pending.routePlanId && run.trackingEndedAt === undefined)
  ));
  return {
    ...completed,
    ...(remainingReturnIntents.length === 0
      ? { pendingReturnIntents: undefined }
      : { pendingReturnIntents: remainingReturnIntents.slice(-MAX_PENDING_RETURN_IDENTITIES) }),
  };
}

export function observeCompletionLocations(
  state: CompletionAssistanceState,
  routePlanId: string,
  samples: CompletionSample[],
): CompletionAssistanceState {
  if (state.capability === 'unsupported') {
    return state;
  }
  let next = cloneState(state);
  const runs = next.runs.filter((run) => run.routePlanId === routePlanId && run.trackingEndedAt === undefined);

  for (const sample of samples) {
    if (!isValidSample(sample)) {
      const runIds = new Set(runs.map((run) => run.runId));
      next = { ...next, visits: next.visits.filter((visit) => !runIds.has(visit.runId)) };
      continue;
    }
    for (const run of runs) {
      next = observeRunSample(next, run, sample);
    }
  }
  return next;
}

export function observeAssignedCompletionLocations(
  state: CompletionAssistanceState,
  identity: CompletionAssignmentIdentity,
  samples: CompletionSample[],
): CompletionAssistanceState {
  if (state.capability === 'unsupported' || !isValidIdentity(identity)) {
    return state;
  }
  const matchingRun = state.runs.find((run) => (
    run.trackingEndedAt === undefined && sameIdentity(run, identity)
  ));
  if (matchingRun !== undefined) {
    return observeCompletionLocations(state, identity.routePlanId, samples);
  }

  const existingBuffers = state.bufferedLocations ?? [];
  const existing = existingBuffers.find((buffered) => sameIdentity(buffered, identity));
  let bufferedSamples = existing?.samples ?? [];
  for (const sample of samples) {
    bufferedSamples = isValidSample(sample) ? [...bufferedSamples, sample] : [];
  }
  if (bufferedSamples.length > 0) {
    const latestTimestamp = Math.max(...bufferedSamples.map((sample) => Date.parse(sample.occurredAt)));
    bufferedSamples = bufferedSamples
      .filter((sample) => Date.parse(sample.occurredAt) >= latestTimestamp - MAX_BUFFERED_AGE_MS)
      .slice(-MAX_BUFFERED_SAMPLES);
  }

  const withoutIdentity = existingBuffers.filter((buffered) => !sameIdentity(buffered, identity));
  const bufferedLocations = bufferedSamples.length === 0
    ? withoutIdentity
    : [...withoutIdentity, { ...identity, samples: bufferedSamples }].slice(-MAX_BUFFERED_IDENTITIES);
  return {
    ...state,
    ...(bufferedLocations.length === 0 ? { bufferedLocations: undefined } : { bufferedLocations }),
  };
}

export function respondToCompletionCandidate(
  state: CompletionAssistanceState,
  candidateId: string,
  response: 'completed' | 'failed' | 'not_completed',
  occurredAt: string,
): CompletionAssistanceState {
  if (!isValidTimestamp(occurredAt)) {
    return state;
  }
  const index = state.candidates.findIndex((candidate) => candidate.candidateId === candidateId);
  const current = state.candidates[index];
  if (index < 0 || current === undefined || current.status === 'invalidated') {
    return state;
  }

  const command: CompletionCommand = {
    kind: 'response',
    commandId: stableId('completion-response', candidateId, String(current.revision), response, occurredAt),
    candidateId,
    runId: current.runId,
    routePlanId: current.routePlanId,
    assignmentGeneration: current.assignmentGeneration,
    expectedRouteVersionId: current.expectedRouteVersionId,
    deliveryStopId: current.deliveryStopId,
    response,
    occurredAt,
    expectedRevision: current.revision,
  };
  if (state.commands.some((item) => item.commandId === command.commandId)) {
    return state;
  }

  const updated: CompletionCandidate = {
    ...current,
    status: 'responded',
    response,
    responseAt: occurredAt,
    revision: current.revision + 1,
  };
  const candidates = [...state.candidates];
  candidates[index] = updated;
  const visitsWithoutCurrent = state.visits.filter((visit) => !(
        visit.runId === current.runId
        && visit.assignmentGeneration === current.assignmentGeneration
        && visit.deliveryStopId === current.deliveryStopId
      ));
  const visits = response === 'not_completed'
    ? [...visitsWithoutCurrent, {
        runId: current.runId,
        assignmentGeneration: current.assignmentGeneration,
        deliveryStopId: current.deliveryStopId,
        stage: 'outside' as const,
        approached: false,
        lastOccurredAt: occurredAt,
        dwellSampleCount: 0,
        evidence: [],
        evidenceOverflow: false,
      }]
    : state.visits;
  return { ...state, candidates, commands: [...state.commands, command], visits };
}

export function recordCompletionManualResponse(
  state: CompletionAssistanceState,
  routePlanId: string,
  deliveryStopId: string,
  response: 'completed' | 'failed',
  occurredAt: string,
  identity?: Omit<CompletionAssignmentIdentity, 'routePlanId'>,
): CompletionAssistanceState {
  if (!isValidTimestamp(occurredAt)) {
    return state;
  }
  const run = state.runs.find((item) => (
    item.routePlanId === routePlanId
    && item.trackingEndedAt === undefined
    && (identity === undefined || (
      item.assignmentGeneration === identity.assignmentGeneration
      && item.expectedRouteVersionId === identity.expectedRouteVersionId
    ))
  ));
  const resolvedIdentity = identity ?? (run === undefined ? undefined : {
    assignmentGeneration: run.assignmentGeneration,
    expectedRouteVersionId: run.expectedRouteVersionId,
  });
  if (resolvedIdentity === undefined || !isValidIdentity({ routePlanId, ...resolvedIdentity })) {
    return state;
  }
  const outcome: CompletionManualOutcome = {
    routePlanId,
    ...resolvedIdentity,
    deliveryStopId,
    response,
    occurredAt,
  };
  const existingOutcomes = state.manualOutcomes ?? [];
  const alreadyRecorded = existingOutcomes.some((item) => sameManualOutcome(item, outcome));
  const manualOutcomes = alreadyRecorded
    ? existingOutcomes
    : trimManualOutcomes([
        ...existingOutcomes.filter((item) => !sameIdentity(item, outcome)
          || item.deliveryStopId !== deliveryStopId),
        outcome,
      ]);
  const stop = run?.stops.find((item) => item.deliveryStopId === deliveryStopId);
  if (run === undefined || stop === undefined) {
    return { ...state, manualOutcomes };
  }
  if (alreadyRecorded && stop.manualResponse?.response === response && stop.manualResponse.occurredAt === occurredAt) {
    return state;
  }

  let next: CompletionAssistanceState = { ...state, manualOutcomes };
  const candidate = findLatestCurrentCandidate(state, run, deliveryStopId);
  if (candidate !== undefined) {
    next = respondToCompletionCandidate(next, candidate.candidateId, response, occurredAt);
  }

  return {
    ...next,
    runs: next.runs.map((item) => item.runId !== run.runId
      ? item
      : {
          ...item,
          stops: item.stops.map((itemStop) => itemStop.deliveryStopId !== deliveryStopId
            ? itemStop
            : {
                ...itemStop,
                manualResponse: { response, occurredAt },
                status: response === 'completed' ? 'DELIVERED' : 'FAILED',
              }),
        }),
    visits: next.visits.filter((visit) => !visitKeyMatches(visit, run, deliveryStopId)),
  };
}

export function recordCompletionReturnIntent(
  state: CompletionAssistanceState,
  routePlanId: string,
  occurredAt: string,
  identity?: Omit<CompletionAssignmentIdentity, 'routePlanId'>,
): CompletionAssistanceState {
  if (!isValidTimestamp(occurredAt)) {
    return state;
  }
  const run = state.runs.find((item) => (
    item.routePlanId === routePlanId
    && (identity === undefined
      ? item.trackingEndedAt === undefined
      : item.assignmentGeneration === identity.assignmentGeneration
        && item.expectedRouteVersionId === identity.expectedRouteVersionId)
  ));
  if (run === undefined) {
    if (identity === undefined || !isValidIdentity({ routePlanId, ...identity })) {
      return state;
    }
    const pending: CompletionPendingReturnIntent = { routePlanId, ...identity, occurredAt };
    const pendingReturnIntents = [
      ...(state.pendingReturnIntents ?? []).filter((item) => !sameIdentity(item, pending)),
      pending,
    ].slice(-MAX_PENDING_RETURN_IDENTITIES);
    return { ...state, pendingReturnIntents };
  }
  const command: CompletionCommand = {
    kind: 'return_intent',
    commandId: stableId('completion-return', run.runId, run.assignmentGeneration, occurredAt),
    runId: run.runId,
    routePlanId: run.routePlanId,
    assignmentGeneration: run.assignmentGeneration,
    expectedRouteVersionId: run.expectedRouteVersionId,
    occurredAt,
  };
  return state.commands.some((item) => item.commandId === command.commandId)
    ? state
    : { ...state, commands: [...state.commands, command] };
}

export function endCompletionTracking(
  state: CompletionAssistanceState,
  routePlanId: string,
  occurredAt: string,
): CompletionAssistanceState {
  if (!isValidTimestamp(occurredAt)) {
    return state;
  }
  const endedRunIds = new Set(
    state.runs.filter((run) => run.routePlanId === routePlanId).map((run) => run.runId),
  );
  return {
    ...state,
    runs: state.runs.map((run) => run.routePlanId === routePlanId
      ? { ...run, trackingEndedAt: run.trackingEndedAt ?? occurredAt }
      : run),
    visits: state.visits.filter((visit) => !endedRunIds.has(visit.runId)),
  };
}

function observeRunSample(
  state: CompletionAssistanceState,
  run: CompletionRun,
  sample: CompletionSample,
): CompletionAssistanceState {
  const eligibleStops = run.stops.filter((stop) => (
    stop.coordinates !== null
    && isValidCoordinate(stop.coordinates)
    && DETECTABLE_STOP_STATUSES.has(normalizeStatus(stop.status))
  ));
  const ambiguousStopIds = findAmbiguousStopIds(eligibleStops, sample, run.policy.ambiguityRadiusMeters);
  const isAmbiguous = ambiguousStopIds.size > 1;
  let next = state;

  for (const stop of eligibleStops) {
    if (hasBlockingCandidate(next, run, stop.deliveryStopId)) {
      continue;
    }
    if (sample.accuracyMeters > run.policy.maxAccuracyMeters || (isAmbiguous && ambiguousStopIds.has(stop.deliveryStopId))) {
      next = resetVisit(next, run, stop.deliveryStopId, sample.occurredAt);
      continue;
    }
    next = observeStopSample(next, run, stop, sample);
  }
  return next;
}

function observeStopSample(
  state: CompletionAssistanceState,
  run: CompletionRun,
  stop: CompletionRun['stops'][number],
  sample: CompletionSample,
): CompletionAssistanceState {
  const coordinates = stop.coordinates!;
  const visitIndex = state.visits.findIndex((visit) => visitKeyMatches(visit, run, stop.deliveryStopId));
  const existing = state.visits[visitIndex] ?? createVisit(run, stop.deliveryStopId);
  const sampleTime = Date.parse(sample.occurredAt);
  const lastTime = existing.lastOccurredAt === undefined ? null : Date.parse(existing.lastOccurredAt);
  if (lastTime !== null && sampleTime <= lastTime) {
    return state;
  }

  const gapExceeded = lastTime !== null && sampleTime - lastTime > run.policy.maxGapMs;
  let visit = gapExceeded
    ? { ...createVisit(run, stop.deliveryStopId), lastOccurredAt: sample.occurredAt }
    : { ...existing, evidence: [...existing.evidence] };
  const certainlyInside = isCertainlyInside(coordinates, sample, run.policy.enterRadiusMeters);
  const certainlyOutsideEntry = isCertainlyOutside(coordinates, sample, run.policy.enterRadiusMeters);
  const certainlyExited = isCertainlyOutside(coordinates, sample, run.policy.exitRadiusMeters);

  if (visit.stage === 'outside') {
    if (certainlyOutsideEntry) {
      visit = { ...visit, approached: true, lastOccurredAt: sample.occurredAt, evidence: [sample] };
    } else if (certainlyInside && visit.approached) {
      visit = {
        ...visit,
        stage: 'dwelling',
        arrivalAt: sample.occurredAt,
        dwellSampleCount: 1,
        lastOccurredAt: sample.occurredAt,
        evidence: appendEvidence(visit.evidence, sample),
      };
    } else if (!certainlyInside) {
      visit = { ...createVisit(run, stop.deliveryStopId), lastOccurredAt: sample.occurredAt };
    } else {
      visit = { ...visit, lastOccurredAt: sample.occurredAt };
    }
    return replaceVisit(state, visitIndex, visit);
  }

  if (certainlyExited) {
    if (visit.dwellCompletedAt === undefined || visit.arrivalAt === undefined) {
      return replaceVisit(state, visitIndex, {
        ...createVisit(run, stop.deliveryStopId),
        approached: true,
        lastOccurredAt: sample.occurredAt,
        evidence: [sample],
      });
    }
    const evidenceOverflow = visit.evidenceOverflow || visit.evidence.length >= MAX_EVIDENCE_SAMPLES;
    const evidence = appendExitEvidence(visit.evidence, sample);
    const candidate = createCandidate(
      run,
      stop,
      { ...visit, evidenceOverflow },
      sample.occurredAt,
      evidence,
    );
    const visits = [...state.visits];
    if (visitIndex >= 0) {
      visits.splice(visitIndex, 1);
    }
    const command: CompletionCommand = {
      kind: 'candidate',
      commandId: stableId('completion-candidate-command', candidate.candidateId),
      candidate,
      occurredAt: candidate.exitAt,
    };
    return {
      ...state,
      visits,
      candidates: [...state.candidates, candidate],
      commands: state.commands.some((item) => item.commandId === command.commandId)
        ? state.commands
        : [...state.commands, command],
    };
  }

  if (!certainlyInside && visit.dwellCompletedAt === undefined) {
    return replaceVisit(state, visitIndex, {
      ...createVisit(run, stop.deliveryStopId),
      lastOccurredAt: sample.occurredAt,
    });
  }

  const evidenceOverflow = visit.evidenceOverflow || visit.evidence.length >= MAX_EVIDENCE_SAMPLES;
  const evidence = appendEvidence(visit.evidence, sample);
  const dwellSampleCount = certainlyInside ? visit.dwellSampleCount + 1 : visit.dwellSampleCount;
  const arrivalTime = Date.parse(visit.arrivalAt!);
  const dwellCompletedAt = visit.dwellCompletedAt ?? (
    certainlyInside
    && dwellSampleCount >= run.policy.minDwellSamples
    && sampleTime - arrivalTime >= run.policy.dwellMs
      ? sample.occurredAt
      : undefined
  );
  visit = {
    ...visit,
    dwellCompletedAt,
    dwellSampleCount,
    evidence,
    evidenceOverflow,
    lastOccurredAt: sample.occurredAt,
  };
  return replaceVisit(state, visitIndex, visit);
}

function createCandidate(
  run: CompletionRun,
  stop: CompletionRun['stops'][number],
  visit: CompletionVisit,
  exitAt: string,
  evidence: CompletionSample[],
): CompletionCandidate {
  const candidateId = stableId(
    'completion-candidate',
    run.runId,
    run.assignmentGeneration,
    stop.deliveryStopId,
    visit.arrivalAt!,
  );
  return {
    candidateId,
    runId: run.runId,
    routePlanId: run.routePlanId,
    assignmentGeneration: run.assignmentGeneration,
    expectedRouteVersionId: run.expectedRouteVersionId,
    deliveryStopId: stop.deliveryStopId,
    ...(run.routeName === undefined ? {} : { routeName: run.routeName }),
    ...(stop.label === undefined ? {} : { stopLabel: stop.label }),
    arrivalAt: visit.arrivalAt!,
    dwellCompletedAt: visit.dwellCompletedAt!,
    exitAt,
    evidence,
    policyVersion: run.policy.version,
    status: visit.evidenceOverflow ? 'held' : 'awaiting_response',
    revision: 0,
    ...(visit.evidenceOverflow ? { holdReason: 'evidence_limit_exceeded' } : {}),
  };
}

function hasBlockingCandidate(state: CompletionAssistanceState, run: CompletionRun, deliveryStopId: string): boolean {
  return state.candidates.some((candidate) => (
    candidate.runId === run.runId
    && candidate.assignmentGeneration === run.assignmentGeneration
    && candidate.deliveryStopId === deliveryStopId
    && candidate.status !== 'invalidated'
    && !(candidate.status === 'responded' && candidate.response === 'not_completed')
  ));
}

function findLatestCurrentCandidate(
  state: CompletionAssistanceState,
  run: CompletionRun,
  deliveryStopId: string,
): CompletionCandidate | undefined {
  for (let index = state.candidates.length - 1; index >= 0; index -= 1) {
    const candidate = state.candidates[index];
    if (
      candidate !== undefined
      && candidate.runId === run.runId
      && candidate.assignmentGeneration === run.assignmentGeneration
      && candidate.expectedRouteVersionId === run.expectedRouteVersionId
      && candidate.deliveryStopId === deliveryStopId
      && candidate.status !== 'invalidated'
    ) {
      return candidate;
    }
  }
  return undefined;
}

function createVisit(run: CompletionRun, deliveryStopId: string): CompletionVisit {
  return {
    runId: run.runId,
    assignmentGeneration: run.assignmentGeneration,
    deliveryStopId,
    stage: 'outside',
    approached: false,
    dwellSampleCount: 0,
    evidence: [],
    evidenceOverflow: false,
  };
}

function resetVisit(
  state: CompletionAssistanceState,
  run: CompletionRun,
  deliveryStopId: string,
  occurredAt: string,
): CompletionAssistanceState {
  const index = state.visits.findIndex((visit) => visitKeyMatches(visit, run, deliveryStopId));
  const current = state.visits[index];
  if (current !== undefined && current.lastOccurredAt !== undefined
    && Date.parse(occurredAt) <= Date.parse(current.lastOccurredAt)) {
    return state;
  }
  return replaceVisit(state, index, {
    ...createVisit(run, deliveryStopId),
    lastOccurredAt: occurredAt,
  });
}

function replaceVisit(
  state: CompletionAssistanceState,
  index: number,
  visit: CompletionVisit,
): CompletionAssistanceState {
  const visits = [...state.visits];
  if (index < 0) {
    visits.push(visit);
  } else {
    visits[index] = visit;
  }
  return { ...state, visits };
}

function visitKeyMatches(
  visit: CompletionVisit,
  run: CompletionRun,
  deliveryStopId: string,
): boolean {
  return visit.runId === run.runId
    && visit.assignmentGeneration === run.assignmentGeneration
    && visit.deliveryStopId === deliveryStopId;
}

function appendEvidence(evidence: CompletionSample[], sample: CompletionSample): CompletionSample[] {
  return evidence.length >= MAX_EVIDENCE_SAMPLES ? evidence : [...evidence, sample];
}

function appendExitEvidence(evidence: CompletionSample[], sample: CompletionSample): CompletionSample[] {
  if (evidence.length < MAX_EVIDENCE_SAMPLES) {
    return [...evidence, sample];
  }
  return [...evidence.slice(0, MAX_EVIDENCE_SAMPLES - 1), sample];
}

function invalidateCandidate(candidate: CompletionCandidate, reason: string): CompletionCandidate {
  return { ...candidate, status: 'invalidated', holdReason: reason };
}

function cloneState(state: CompletionAssistanceState): CompletionAssistanceState {
  return {
    ...state,
    runs: state.runs.map(copyRun),
    candidates: state.candidates.map((candidate) => ({ ...candidate, evidence: [...candidate.evidence] })),
    commands: [...state.commands],
    visits: state.visits.map((visit) => ({ ...visit, evidence: [...visit.evidence] })),
    ...(state.bufferedLocations === undefined ? {} : {
      bufferedLocations: state.bufferedLocations.map((buffered) => ({
        ...buffered,
        samples: [...buffered.samples],
      })),
    }),
    ...(state.manualOutcomes === undefined ? {} : {
      manualOutcomes: state.manualOutcomes.map((outcome) => ({ ...outcome })),
    }),
    ...(state.pendingReturnIntents === undefined ? {} : {
      pendingReturnIntents: state.pendingReturnIntents.map((intent) => ({ ...intent })),
    }),
  };
}

function copyRun(run: CompletionRun): CompletionRun {
  return {
    ...run,
    policy: { ...run.policy },
    stops: run.stops.map((stop) => ({
      ...stop,
      coordinates: stop.coordinates === null ? null : { ...stop.coordinates },
      ...(stop.manualResponse === undefined ? {} : { manualResponse: { ...stop.manualResponse } }),
    })),
  };
}

function isCertainlyInside(
  coordinates: { latitude: number; longitude: number },
  sample: CompletionSample,
  radiusMeters: number,
): boolean {
  return distanceMeters(coordinates, sample) + sample.accuracyMeters <= radiusMeters;
}

function isCertainlyOutside(
  coordinates: { latitude: number; longitude: number },
  sample: CompletionSample,
  radiusMeters: number,
): boolean {
  return distanceMeters(coordinates, sample) - sample.accuracyMeters >= radiusMeters;
}

function findAmbiguousStopIds(
  stops: CompletionRun['stops'],
  sample: CompletionSample,
  ambiguityRadiusMeters: number,
): Set<string> {
  const result = new Set<string>();
  for (let leftIndex = 0; leftIndex < stops.length; leftIndex += 1) {
    const left = stops[leftIndex];
    if (left?.coordinates === null || left?.coordinates === undefined) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < stops.length; rightIndex += 1) {
      const right = stops[rightIndex];
      if (right?.coordinates === null || right?.coordinates === undefined) {
        continue;
      }
      const geofencesOverlap = distanceMeters(left.coordinates, right.coordinates) <= ambiguityRadiusMeters * 2;
      const sampleCouldBelongToLeft = distanceMeters(left.coordinates, sample) - sample.accuracyMeters <= ambiguityRadiusMeters;
      const sampleCouldBelongToRight = distanceMeters(right.coordinates, sample) - sample.accuracyMeters <= ambiguityRadiusMeters;
      if (geofencesOverlap && sampleCouldBelongToLeft && sampleCouldBelongToRight) {
        result.add(left.deliveryStopId);
        result.add(right.deliveryStopId);
      }
    }
  }
  return result;
}

function distanceMeters(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
): number {
  const toRadians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function isValidSample(sample: CompletionSample): boolean {
  return isValidCoordinate(sample)
    && Number.isFinite(sample.accuracyMeters)
    && sample.accuracyMeters >= 0
    && isValidTimestamp(sample.occurredAt)
    && Date.parse(sample.occurredAt) <= Date.now() + FUTURE_SAMPLE_TOLERANCE_MS;
}

function isValidCoordinate(value: { latitude: number; longitude: number }): boolean {
  return Number.isFinite(value.latitude)
    && value.latitude >= -90
    && value.latitude <= 90
    && Number.isFinite(value.longitude)
    && value.longitude >= -180
    && value.longitude <= 180;
}

function isValidTimestamp(value: string): boolean {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return false;
  }
  return new Date(value).toISOString() === value;
}

function normalizeStatus(value: string): string {
  return value.trim().toUpperCase();
}

function sameIdentity(left: CompletionAssignmentIdentity, right: CompletionAssignmentIdentity): boolean {
  return left.routePlanId === right.routePlanId
    && left.assignmentGeneration === right.assignmentGeneration
    && left.expectedRouteVersionId === right.expectedRouteVersionId;
}

function isValidIdentity(identity: CompletionAssignmentIdentity): boolean {
  return identity.routePlanId.trim().length > 0
    && identity.assignmentGeneration.trim().length > 0
    && identity.expectedRouteVersionId.trim().length > 0;
}

function sameManualOutcome(left: CompletionManualOutcome, right: CompletionManualOutcome): boolean {
  return sameIdentity(left, right)
    && left.deliveryStopId === right.deliveryStopId
    && left.response === right.response
    && left.occurredAt === right.occurredAt;
}

function trimManualOutcomes(outcomes: CompletionManualOutcome[]): CompletionManualOutcome[] {
  const retainedIdentityKeys = new Set<string>();
  for (let index = outcomes.length - 1; index >= 0; index -= 1) {
    const outcome = outcomes[index];
    if (outcome === undefined) {
      continue;
    }
    const key = identityKey(outcome);
    if (retainedIdentityKeys.has(key)) {
      continue;
    }
    if (retainedIdentityKeys.size >= MAX_MANUAL_OUTCOME_IDENTITIES) {
      break;
    }
    retainedIdentityKeys.add(key);
  }
  return outcomes.filter((outcome) => retainedIdentityKeys.has(identityKey(outcome)));
}

function identityKey(identity: CompletionAssignmentIdentity): string {
  return stableId(identity.routePlanId, identity.assignmentGeneration, identity.expectedRouteVersionId);
}

function samePolicy(left: CompletionPolicy, right: CompletionPolicy): boolean {
  return POLICY_KEYS.every((key) => left[key] === right[key]);
}

function sameCoordinates(
  left: { latitude: number; longitude: number } | null,
  right: { latitude: number; longitude: number } | null,
): boolean {
  return left !== null
    && right !== null
    && left.latitude === right.latitude
    && left.longitude === right.longitude;
}

function stableId(...parts: string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join(':');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isBoundedSampleCount(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 3
    && value <= MAX_EVIDENCE_SAMPLES - 2;
}
