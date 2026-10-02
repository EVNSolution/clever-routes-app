import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { runBoundedAsyncOperation } from '../domain/async/boundedAsyncOperation';
import {
  emptyCompletionAssistanceState, endCompletionTracking, recordCompletionReturnIntent,
  recordCompletionManualResponse, respondToCompletionCandidate, type CompletionAssistanceState, type CompletionCandidate,
} from '../domain/completion/completionAssistance';
import { synchronizeCompletionAssistance } from '../domain/completion/completionAssistanceSync';
import { notifyCompletionCandidates } from '../domain/completion/completionAssistanceNotifications';
import { createExpoCompletionAssistanceStore, getCompletionAccountOwnerHash } from '../platform/expo/storage/expoCompletionAssistanceStore';
import { emitCompletionAssistanceChange, invalidateCompletionAssistanceWork, subscribeCompletionAssistance } from '../platform/expo/location/expoCompletionAssistance';
import { listenForCompletionCandidatePress, showCompletionCandidateNotification } from '../platform/expo/notifications/expoCompletionAssistanceNotifications';
import type { DriverAccountAccessToken } from '../domain/driverAuth/driverAuth';

export function useCompletionAssistance(input: {
  enabled: boolean;
  phoneE164: string | null;
  baseUrl: string;
  activeRoutePlanId: string | null;
  getAccountAccess(options: { isCurrent: () => boolean }): Promise<DriverAccountAccessToken | null>;
  onOpen(): void;
}) {
  const [state, setState] = useState(emptyCompletionAssistanceState);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [stateOwner, setStateOwner] = useState<string | null>(null);
  const session = useRef<{ owner: string; controller: AbortController } | null>(null);
  const callbacks = useRef(input);
  useEffect(() => { callbacks.current = input; }, [input]);
  const inFlight = useRef<Promise<void> | null>(null);
  const trailingSyncRequested = useRef(false);

  const reload = useCallback(async () => {
    const current = session.current;
    if (current === null || current.controller.signal.aborted) return;
    const store = await createExpoCompletionAssistanceStore();
    const saved = await store.read(current.owner);
    if (session.current === current && !current.controller.signal.aborted) setState(saved);
  }, []);

  const sync = useCallback(async (): Promise<void> => {
    if (inFlight.current !== null) {
      trailingSyncRequested.current = true;
      return inFlight.current;
    }
    const current = session.current;
    if (current === null || current.controller.signal.aborted) return;
    const isCurrent = () => session.current === current && !current.controller.signal.aborted;
    const operation = (async () => {
      setSyncing(true);
      try {
        do {
          trailingSyncRequested.current = false;
          try {
            const accountAccess = await runBoundedAsyncOperation(
              () => callbacks.current.getAccountAccess({ isCurrent }),
              { timeoutMs: 15_000, signal: current.controller.signal },
            );
            if (!isCurrent() || accountAccess === null) return;
            const store = await createExpoCompletionAssistanceStore();
            const result = await synchronizeCompletionAssistance({
              store, accountOwnerHash: current.owner, baseUrl: callbacks.current.baseUrl,
              accessToken: accountAccess.accessToken, isCurrent, signal: current.controller.signal,
            });
            if (!isCurrent()) return;
            setSupported(result.supported);
            await notifyCompletionCandidates({
              store, accountOwnerHash: current.owner, notify: (candidate) => showCompletionCandidateNotification(candidate, current.owner), isCurrent,
            });
            await reload();
            if (isCurrent()) setError(null);
          } catch {
            if (isCurrent()) {
              setError('Delivery confirmations could not sync. Saved responses will retry when connected.');
              await reload().catch(() => undefined);
            }
          }
        } while (trailingSyncRequested.current && isCurrent());
      } finally {
        if (isCurrent()) setSyncing(false);
      }
    })();
    inFlight.current = operation;
    try { await operation; } finally {
      if (inFlight.current === operation) {
        inFlight.current = null;
      }
    }
  }, [reload]);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    let notification = () => {};
    if (!input.enabled || input.phoneE164 === null) return;
    void getCompletionAccountOwnerHash(input.phoneE164).then(async (owner) => {
      if (disposed) return;
      setState(emptyCompletionAssistanceState());
      setStateOwner(input.phoneE164);
      setError(null);
      setSupported(false);
      setSyncing(false);
      session.current = { owner, controller };
      await reload();
      if (disposed) return;
      notification = listenForCompletionCandidatePress(async (candidateId, notificationOwner) => {
        if (disposed || controller.signal.aborted || notificationOwner !== owner) return false;
        const saved = await (await createExpoCompletionAssistanceStore()).read(owner);
        if (disposed || controller.signal.aborted || !saved.candidates.some((candidate) => candidate.candidateId === candidateId)) return false;
        callbacks.current.onOpen();
        return true;
      });
      await sync();
    }).catch(() => {
      if (!disposed) {
        setStateOwner(input.phoneE164);
        setError('Delivery confirmation storage is unavailable. Please try again.');
      }
    });
    const unsubscribe = subscribeCompletionAssistance(() => { void reload().catch(() => undefined); });
    const appState = AppState.addEventListener('change', (status) => { if (status === 'active') void sync(); });
    const retry = setInterval(() => { if (AppState.currentState === 'active') void sync(); }, 60_000);
    return () => {
      disposed = true;
      controller.abort();
      if (session.current?.controller === controller) session.current = null;
      inFlight.current = null;
      trailingSyncRequested.current = false;
      invalidateCompletionAssistanceWork();
      clearInterval(retry);
      unsubscribe();
      appState.remove();
      notification();
    };
  }, [input.enabled, input.phoneE164, reload, sync]);

  useEffect(() => {
    invalidateCompletionAssistanceWork();
    void sync();
  }, [input.activeRoutePlanId, sync]);

  const update = useCallback(async (mutate: (current: CompletionAssistanceState) => CompletionAssistanceState) => {
    const current = session.current;
    if (current === null || current.controller.signal.aborted) return false;
    try {
      const store = await createExpoCompletionAssistanceStore();
      if (session.current !== current || current.controller.signal.aborted) return false;
      const saved = await store.update(current.owner, (latest) => (
        session.current === current && !current.controller.signal.aborted ? mutate(latest) : latest
      ));
      if (session.current !== current || current.controller.signal.aborted) return false;
      setState(saved);
      setError(null);
      emitCompletionAssistanceChange();
      void sync();
      return true;
    } catch {
      setError('The response could not be saved. Please try again; no completion was confirmed.');
      return false;
    }
  }, [sync]);

  const visible = input.enabled && stateOwner === input.phoneE164;
  return {
    state: visible ? state : emptyCompletionAssistanceState(),
    error: visible ? error : null,
    supported: visible && supported,
    syncing: visible && syncing,
    sync,
    respond: (candidateId: string, response: NonNullable<CompletionCandidate['response']>) => update(
      (current) => respondToCompletionCandidate(current, candidateId, response, new Date().toISOString()),
    ),
    recordManualResponse: (routePlanId: string, stopId: string, response: 'completed' | 'failed', identity?: {
      assignmentGeneration: string; expectedRouteVersionId: string;
    }) => update(
      (current) => recordCompletionManualResponse(current, routePlanId, stopId, response, new Date().toISOString(), identity),
    ),
    returnIntent: (routePlanId: string, identity?: { assignmentGeneration: string; expectedRouteVersionId: string }) => update(
      (current) => recordCompletionReturnIntent(current, routePlanId, new Date().toISOString(), identity),
    ),
    endTracking: (routePlanId: string) => update((current) => endCompletionTracking(current, routePlanId, new Date().toISOString())),
    canDeleteAccount: async () => {
      const current = session.current;
      if (current === null) return !callbacks.current.enabled || callbacks.current.phoneE164 === null;
      const saved = await (await createExpoCompletionAssistanceStore()).read(current.owner);
      return saved.commands.length === 0;
    },
    clearDeletedAccount: async () => {
      const current = session.current;
      if (current !== null) await (await createExpoCompletionAssistanceStore()).remove(current.owner);
    },
    suspend: () => { session.current?.controller.abort(); invalidateCompletionAssistanceWork(); },
  };
}
