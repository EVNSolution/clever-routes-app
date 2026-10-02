import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CompletionAssistanceSyncRetryError,
  createCompletionAssistanceStore,
  synchronizeCompletionAssistance,
  type CompletionAssistanceRawStorage,
  type CompletionAssistanceStore,
} from './completionAssistanceSync';
import {
  emptyCompletionAssistanceState,
  type CompletionAssistanceState,
  type CompletionCandidate,
  type CompletionCommand,
  type CompletionRun,
} from './completionAssistance';

const owner = 'ab'.repeat(32);

function run(): CompletionRun {
  return {
    assignmentGeneration: '1',
    expectedRouteVersionId: '11111111-1111-4111-8111-111111111111',
    policy: {
      ambiguityRadiusMeters: 100,
      dwellMs: 60_000,
      enterRadiusMeters: 100,
      exitRadiusMeters: 200,
      maxAccuracyMeters: 50,
      maxGapMs: 35_000,
      minDwellSamples: 3,
      version: 'visit-v1',
    },
    routeName: 'South',
    routePlanId: 'route-1',
    runId: 'run-1',
    stops: [{
      coordinates: { latitude: 37.5, longitude: 127 },
      deliveryStopId: 'stop-1',
      label: '1번 배송지',
      status: 'PENDING',
    }],
  };
}

function candidate(input: Partial<CompletionCandidate> = {}): CompletionCandidate {
  return {
    arrivalAt: '2026-09-17T12:00:00.000Z',
    assignmentGeneration: '1',
    candidateId: 'candidate-1',
    deliveryStopId: 'stop-1',
    dwellCompletedAt: '2026-09-17T12:01:00.000Z',
    evidence: [
      { accuracyMeters: 5, latitude: 37.5, longitude: 127, occurredAt: '2026-09-17T12:00:00.000Z' },
      { accuracyMeters: 5, latitude: 37.5, longitude: 127, occurredAt: '2026-09-17T12:01:00.000Z' },
      { accuracyMeters: 5, latitude: 37.502, longitude: 127, occurredAt: '2026-09-17T12:01:10.000Z' },
    ],
    exitAt: '2026-09-17T12:01:10.000Z',
    expectedRouteVersionId: '11111111-1111-4111-8111-111111111111',
    policyVersion: 'visit-v1',
    responseDeadlineAt: '2026-09-18T12:01:10.000Z',
    revision: 0,
    routeName: 'South',
    routePlanId: 'route-1',
    runId: 'run-1',
    status: 'awaiting_response',
    stopLabel: '1번 배송지',
    ...input,
  };
}

function memoryStore(initial: CompletionAssistanceState): CompletionAssistanceStore {
  let state = structuredClone(initial);
  return {
    read: async () => structuredClone(state),
    remove: async () => { state = emptyCompletionAssistanceState(); },
    update: async (_accountOwnerHash, mutate) => {
      state = mutate(structuredClone(state));
      return structuredClone(state);
    },
  };
}

function controlledMemoryStore(initial: CompletionAssistanceState) {
  let state = structuredClone(initial);
  const store: CompletionAssistanceStore = {
    read: async () => structuredClone(state),
    remove: async () => { state = emptyCompletionAssistanceState(); },
    update: async (_accountOwnerHash, mutate) => {
      state = mutate(structuredClone(state));
      return structuredClone(state);
    },
  };
  return {
    read: () => structuredClone(state),
    store,
    update: (mutate: (current: CompletionAssistanceState) => CompletionAssistanceState) => {
      state = mutate(structuredClone(state));
    },
  };
}

function responseCommand(): Extract<CompletionCommand, { kind: 'response' }> {
  return {
    assignmentGeneration: '1',
    candidateId: 'candidate-1',
    commandId: 'response-command-1',
    deliveryStopId: 'stop-1',
    expectedRevision: 0,
    expectedRouteVersionId: '11111111-1111-4111-8111-111111111111',
    kind: 'response',
    occurredAt: '2026-09-17T12:02:00.000Z',
    response: 'completed',
    routePlanId: 'route-1',
    runId: 'run-1',
  };
}

describe('completion assistance encrypted state adapter', () => {
  it('persists state across restart and fails closed for malformed or newer payloads', async () => {
    const values = new Map<string, string>();
    const raw: CompletionAssistanceRawStorage = {
      readCompletionAssistanceState: async (key) => values.get(key) ?? null,
      removeCompletionAssistanceState: async (key) => { values.delete(key); },
      updateCompletionAssistanceState: async (key, mutate) => {
        const updated = mutate(values.get(key) ?? null);
        values.set(key, updated);
        return updated;
      },
    };
    const first = createCompletionAssistanceStore(raw);
    const firstResponse = responseCommand();
    const secondResponse: Extract<CompletionCommand, { kind: 'response' }> = {
      ...firstResponse,
      commandId: 'response-command-2',
      expectedRevision: 1,
      previousResponseCommandId: firstResponse.commandId,
      response: 'failed',
    };
    await first.update(owner, (state) => ({
      ...state,
      bufferedLocations: [{
        assignmentGeneration: '1',
        expectedRouteVersionId: '11111111-1111-4111-8111-111111111111',
        routePlanId: 'route-1',
        samples: [{ accuracyMeters: 5, latitude: 37.5, longitude: 127, occurredAt: '2026-09-17T11:00:00.000Z' }],
      }],
      capability: 'supported',
      manualOutcomes: [{
        assignmentGeneration: '1', deliveryStopId: 'stop-1', expectedRouteVersionId: '11111111-1111-4111-8111-111111111111',
        occurredAt: '2026-09-17T11:01:00.000Z', response: 'completed', routePlanId: 'route-1',
      }],
      pendingReturnIntents: [{
        assignmentGeneration: '1', expectedRouteVersionId: '11111111-1111-4111-8111-111111111111',
        occurredAt: '2026-09-17T11:02:00.000Z', routePlanId: 'route-1',
      }],
      candidates: [candidate({ responseDeadlineAt: undefined })],
      commands: [firstResponse, secondResponse],
      runs: [run()],
    }));
    const restored = await createCompletionAssistanceStore(raw).read(owner);
    assert.deepEqual(restored.runs, [run()]);
    assert.equal(restored.capability, 'supported');
    assert.equal(restored.bufferedLocations?.length, 1);
    assert.equal(restored.manualOutcomes?.length, 1);
    assert.equal(restored.pendingReturnIntents?.length, 1);
    assert.equal(restored.candidates[0]?.responseDeadlineAt, undefined);
    assert.deepEqual(restored.commands, [firstResponse, secondResponse]);

    values.set(owner, JSON.stringify({
      ...restored,
      commands: [{
        ...secondResponse,
        previousResponseCommandId: secondResponse.commandId,
      }],
    }));
    await assert.rejects(first.read(owner), /malformed/u);

    values.set(owner, JSON.stringify({ ...emptyCompletionAssistanceState(), schemaVersion: 2 }));
    await assert.rejects(first.read(owner), /newer schema version/u);
    assert.equal(values.has(owner), true);
    values.set(owner, '{"schemaVersion":1,"runs":');
    await assert.rejects(first.read(owner), /malformed/u);
    assert.equal(values.has(owner), true);
  });
});

describe('completion assistance account synchronization', () => {
  it('replays the same command ID after a lost ACK and uploads before GET', async () => {
    const command = responseCommand();
    const state: CompletionAssistanceState = {
      ...emptyCompletionAssistanceState(),
      candidates: [candidate({ response: 'completed', responseAt: command.occurredAt, revision: 1, status: 'responded' })],
      commands: [command],
      runs: [run()],
    };
    const store = memoryStore(state);
    const firstIds: string[] = [];
    await assert.rejects(synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async (_url, init) => {
        firstIds.push((JSON.parse(String(init?.body)) as { command: CompletionCommand }).command.commandId);
        throw new TypeError('offline after upload');
      },
    }), CompletionAssistanceSyncRetryError);
    assert.deepEqual((await store.read(owner)).commands.map((item) => item.commandId), [command.commandId]);

    const methods: string[] = [];
    const secondIds: string[] = [];
    const second = await synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async (_url, init) => {
        methods.push(init?.method ?? 'GET');
        if (init?.method === 'POST') {
          const commandId = (JSON.parse(String(init.body)) as { command: CompletionCommand }).command.commandId;
          secondIds.push(commandId);
          return new Response(JSON.stringify({
            candidate: candidate({
              response: 'completed', responseAt: command.occurredAt, revision: 1, status: 'responded',
            }),
            contractVersion: 1,
            commandId,
            status: 'duplicate',
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          candidates: [candidate({ revision: 1, status: 'responded', response: 'completed', responseAt: command.occurredAt })],
          contractVersion: 1,
          runs: [run()],
          serverTime: '2026-09-17T12:03:00.000Z',
        }), { status: 200 });
      },
    });
    assert.deepEqual(firstIds, [command.commandId]);
    assert.deepEqual(secondIds, [command.commandId]);
    assert.deepEqual(methods, ['POST', 'GET']);
    assert.deepEqual(second.state.commands, []);
  });

  it('preserves a queued manual response and notification claim over a stale server snapshot', async () => {
    const command = responseCommand();
    const local = candidate({
      notified: true,
      response: 'completed',
      responseAt: command.occurredAt,
      revision: 2,
      status: 'responded',
    });
    const store = memoryStore({
      ...emptyCompletionAssistanceState(), candidates: [local], commands: [command], runs: [run()],
    });
    let postAttempts = 0;
    await assert.rejects(synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async (_url, init) => {
        if (init?.method === 'POST') {
          postAttempts += 1;
          return new Response('temporarily unavailable', { status: 503 });
        }
        throw new Error('GET must not overtake an unacknowledged explicit response');
      },
    }), CompletionAssistanceSyncRetryError);
    assert.equal(postAttempts, 1);
    assert.deepEqual((await store.read(owner)).candidates, [local]);
    assert.deepEqual((await store.read(owner)).commands, [command]);
  });

  it('does not roll back a locally revised explicit response when GET is stale after its ACK', async () => {
    const command = responseCommand();
    const local = candidate({
      notified: true,
      response: 'completed',
      responseAt: command.occurredAt,
      revision: 2,
      status: 'responded',
    });
    const store = memoryStore({
      ...emptyCompletionAssistanceState(), candidates: [local], commands: [command], runs: [run()],
    });
    const result = await synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async (_url, init) => init?.method === 'POST'
        ? new Response(JSON.stringify({
            candidate: local,
            commandId: command.commandId, contractVersion: 1, status: 'applied',
          }), { status: 200 })
        : new Response(JSON.stringify({
            candidates: [candidate({ revision: 0, status: 'awaiting_response' })],
            contractVersion: 1,
            runs: [run()],
            serverTime: '2026-09-17T12:03:00.000Z',
          }), { status: 200 }),
    });
    assert.deepEqual(result.state.commands, []);
    assert.deepEqual(result.state.candidates, [local]);
  });

  it('preserves a newer local response added while an older response ACK is in flight', async () => {
    const first = responseCommand();
    const initialCandidate = candidate({
      response: 'completed', responseAt: first.occurredAt, revision: 1, status: 'responded',
    });
    const controlled = controlledMemoryStore({
      ...emptyCompletionAssistanceState(), candidates: [initialCandidate], commands: [first], runs: [run()],
    });
    let resolvePost!: (response: Response) => void;
    let signalPostStarted!: () => void;
    const postStarted = new Promise<void>((resolve) => { signalPostStarted = resolve; });
    const methods: string[] = [];
    const sync = synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store: controlled.store,
      fetchImpl: async (_url, init) => {
        methods.push(init?.method ?? 'GET');
        if (init?.method === 'POST') {
          signalPostStarted();
          return new Promise((resolve) => { resolvePost = resolve; });
        }
        return new Response(JSON.stringify({
          candidates: [candidate({
            response: 'completed', responseAt: first.occurredAt, revision: 1, status: 'responded',
          })],
          contractVersion: 1,
          runs: [run()],
          serverTime: '2026-09-17T12:04:00.000Z',
        }), { status: 200 });
      },
    });
    await postStarted;
    const second: Extract<CompletionCommand, { kind: 'response' }> = {
      ...first,
      commandId: 'response-command-2',
      expectedRevision: 1,
      occurredAt: '2026-09-17T12:03:00.000Z',
      response: 'failed',
    };
    const latestCandidate = candidate({
      response: 'failed', responseAt: second.occurredAt, revision: 2, status: 'responded',
    });
    controlled.update((state) => ({
      ...state,
      candidates: [latestCandidate],
      commands: [...state.commands, second],
    }));
    resolvePost(new Response(JSON.stringify({
      candidate: initialCandidate,
      commandId: first.commandId,
      contractVersion: 1,
      status: 'applied',
    }), { status: 200 }));

    const result = await sync;
    assert.deepEqual(methods, ['POST', 'GET']);
    assert.deepEqual(result.state.candidates, [latestCandidate]);
    assert.deepEqual(result.state.commands, [second]);
    assert.deepEqual(controlled.read(), result.state);
  });

  it('replays immutable response lineage across ACK loss and accepts the canonical revision shift', async () => {
    const first = responseCommand();
    const second: Extract<CompletionCommand, { kind: 'response' }> = {
      ...first,
      commandId: 'response-command-2',
      expectedRevision: 1,
      occurredAt: '2026-09-19T12:03:00.000Z',
      previousResponseCommandId: first.commandId,
      response: 'failed',
    };
    const optimistic = candidate({
      response: 'failed', responseAt: second.occurredAt, revision: 2, status: 'responded',
    });
    const inferred = candidate({
      autoCompletedAt: '2026-09-18T12:01:10.000Z',
      revision: 1,
      status: 'inferred_completed',
    });
    const store = memoryStore({
      ...emptyCompletionAssistanceState(), candidates: [optimistic], commands: [first, second], runs: [run()],
    });
    let authoritative = inferred;
    let lastExplicitResponseCommandId: string | undefined;
    let loseFirstAcknowledgement = true;
    const firstCommandBodies: string[] = [];
    const applied = new Map<string, CompletionCandidate>();
    const fetchImpl = async (_url: string, init?: RequestInit): Promise<Response> => {
      if (init?.method !== 'POST') {
        return new Response(JSON.stringify({
          candidates: [authoritative], contractVersion: 1, runs: [run()], serverTime: '2026-09-19T12:04:00.000Z',
        }), { status: 200 });
      }
      const body = String(init.body);
      const posted = (JSON.parse(body) as { command: CompletionCommand }).command;
      if (posted.commandId === first.commandId) firstCommandBodies.push(body);
      const prior = applied.get(posted.commandId);
      if (prior !== undefined) {
        return new Response(JSON.stringify({
          candidate: prior, commandId: posted.commandId, contractVersion: 1, status: 'duplicate',
        }), { status: 200 });
      }
      assert.equal(posted.kind, 'response');
      if (posted.kind !== 'response') throw new Error('expected response command');
      if (posted.commandId === first.commandId) {
        assert.equal(posted.expectedRevision, 0);
        assert.equal(posted.previousResponseCommandId, undefined);
        authoritative = candidate({
          response: 'completed', responseAt: posted.occurredAt, revision: 2, status: 'responded',
        });
      } else {
        assert.equal(posted.commandId, second.commandId);
        assert.equal(posted.expectedRevision, 1);
        assert.equal(posted.previousResponseCommandId, lastExplicitResponseCommandId);
        authoritative = candidate({
          response: 'failed', responseAt: posted.occurredAt, revision: 3, status: 'responded',
        });
      }
      lastExplicitResponseCommandId = posted.commandId;
      applied.set(posted.commandId, authoritative);
      if (posted.commandId === first.commandId && loseFirstAcknowledgement) {
        loseFirstAcknowledgement = false;
        throw new TypeError('connection lost after apply');
      }
      return new Response(JSON.stringify({
        candidate: authoritative, commandId: posted.commandId, contractVersion: 1, status: 'applied',
      }), { status: 200 });
    };

    await assert.rejects(synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', fetchImpl, store,
    }), CompletionAssistanceSyncRetryError);
    assert.deepEqual((await store.read(owner)).commands, [first, second]);

    const result = await synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', fetchImpl, store,
    });
    assert.equal(firstCommandBodies.length, 2);
    assert.equal(firstCommandBodies[0], firstCommandBodies[1]);
    assert.deepEqual(result.state.commands, []);
    assert.equal(result.state.candidates[0]?.revision, 3);
    assert.equal(result.state.candidates[0]?.response, 'failed');
    assert.equal(result.state.candidates[0]?.status, 'responded');
  });

  it('keeps response commands when an applied or duplicate ACK omits its authoritative candidate', async () => {
    for (const status of ['applied', 'duplicate'] as const) {
      const command = responseCommand();
      const store = memoryStore({
        ...emptyCompletionAssistanceState(), candidates: [candidate()], commands: [command], runs: [run()],
      });
      await assert.rejects(synchronizeCompletionAssistance({
        accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
        fetchImpl: async () => new Response(JSON.stringify({
          commandId: command.commandId, contractVersion: 1, status,
        }), { status: 200 }),
      }), /authoritative candidate/u);
      assert.deepEqual((await store.read(owner)).commands, [command]);
    }
  });

  it('keeps a response command when its ACK candidate does not reflect the exact response event', async () => {
    const command = responseCommand();
    const mismatches: {
      acknowledgementStatus: 'applied' | 'duplicate';
      authoritative: CompletionCandidate;
    }[] = [
      {
        acknowledgementStatus: 'applied',
        authoritative: candidate({
          autoCompletedAt: '2026-09-18T12:01:10.000Z', revision: 1, status: 'inferred_completed',
        }),
      },
      {
        acknowledgementStatus: 'duplicate',
        authoritative: candidate({
          response: 'failed', responseAt: command.occurredAt, revision: 1, status: 'responded',
        }),
      },
      {
        acknowledgementStatus: 'applied',
        authoritative: candidate({
          response: command.response, responseAt: '2026-09-17T12:02:00.001Z', revision: 1, status: 'responded',
        }),
      },
      {
        acknowledgementStatus: 'duplicate',
        authoritative: candidate({
          response: command.response, responseAt: command.occurredAt, revision: command.expectedRevision, status: 'responded',
        }),
      },
    ];

    for (const { acknowledgementStatus, authoritative } of mismatches) {
      const store = memoryStore({
        ...emptyCompletionAssistanceState(), candidates: [candidate()], commands: [command], runs: [run()],
      });
      await assert.rejects(synchronizeCompletionAssistance({
        accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
        fetchImpl: async () => new Response(JSON.stringify({
          candidate: authoritative,
          commandId: command.commandId,
          contractVersion: 1,
          status: acknowledgementStatus,
        }), { status: 200 }),
      }), /does not reflect the queued command/u);
      assert.deepEqual((await store.read(owner)).commands, [command]);
    }
  });

  it('keeps a response command when a rejected ACK omits an existing authoritative candidate', async () => {
    const command = responseCommand();
    const store = memoryStore({
      ...emptyCompletionAssistanceState(), candidates: [candidate()], commands: [command], runs: [run()],
    });
    await assert.rejects(synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async () => new Response(JSON.stringify({
        commandId: command.commandId, contractVersion: 1, reason: 'revision_conflict', status: 'rejected',
      }), { status: 200 }),
    }), /current authoritative candidate/u);
    assert.deepEqual((await store.read(owner)).commands, [command]);
  });

  it('does not consume a command for a malformed or mismatched ACK', async () => {
    const command = responseCommand();
    const store = memoryStore({
      ...emptyCompletionAssistanceState(), candidates: [candidate()], commands: [command], runs: [run()],
    });
    await assert.rejects(synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async () => new Response(JSON.stringify({
        commandId: 'another-command', contractVersion: 1, status: 'applied',
      }), { status: 200 }),
    }), /command ID/u);
    assert.deepEqual((await store.read(owner)).commands.map((item) => item.commandId), [command.commandId]);
  });

  it('rejects an ACK candidate from a different stop without consuming the command', async () => {
    const command = responseCommand();
    const store = memoryStore({
      ...emptyCompletionAssistanceState(), candidates: [candidate()], commands: [command], runs: [run()],
    });
    await assert.rejects(synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async () => new Response(JSON.stringify({
        candidate: candidate({ candidateId: 'candidate-other', deliveryStopId: 'stop-other' }),
        commandId: command.commandId,
        contractVersion: 1,
        status: 'applied',
      }), { status: 200 }),
    }), /candidate identity/u);
    assert.deepEqual((await store.read(owner)).commands, [command]);
  });

  it('removes a rejected response from retry and retains actionable held conflict evidence', async () => {
    const command = responseCommand();
    const store = memoryStore({
      ...emptyCompletionAssistanceState(), candidates: [candidate()], commands: [command], runs: [run()],
    });
    const result = await synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async (_url, init) => init?.method === 'POST'
        ? new Response(JSON.stringify({
            candidate: candidate(),
            commandId: command.commandId, contractVersion: 1, reason: 'revision_conflict', status: 'rejected',
          }), { status: 200 })
        : new Response(JSON.stringify({
            candidates: [], contractVersion: 1, runs: [run()], serverTime: '2026-09-17T12:03:00.000Z',
          }), { status: 200 }),
    });
    assert.deepEqual(result.state.commands, []);
    assert.equal(result.state.candidates[0]?.status, 'held');
    assert.equal(result.state.candidates[0]?.holdReason, 'server_rejected:revision_conflict');
  });

  it('uses the authoritative server revision when a response is rejected', async () => {
    const command = responseCommand();
    const optimistic = candidate({
      response: 'completed', responseAt: command.occurredAt, revision: 3, status: 'responded',
    });
    const authoritative = candidate({ revision: 7, status: 'awaiting_response' });
    const store = memoryStore({
      ...emptyCompletionAssistanceState(), candidates: [optimistic], commands: [command], runs: [run()],
    });
    const result = await synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async (_url, init) => init?.method === 'POST'
        ? new Response(JSON.stringify({
            candidate: authoritative,
            commandId: command.commandId,
            contractVersion: 1,
            reason: 'revision_conflict',
            status: 'rejected',
          }), { status: 200 })
        : new Response(JSON.stringify({
            candidates: [authoritative], contractVersion: 1, runs: [run()], serverTime: '2026-09-17T12:03:00.000Z',
          }), { status: 200 }),
    });
    assert.equal(result.state.candidates[0]?.revision, 7);
    assert.equal(result.state.candidates[0]?.status, 'held');
    assert.equal(result.state.candidates[0]?.holdReason, 'server_rejected:revision_conflict');
  });

  it('preserves rejected authoritative invalidation across the same-revision snapshot and restart', async () => {
    const command = responseCommand();
    const authoritative = candidate({ revision: 7, status: 'invalidated', holdReason: 'assignment_changed' });
    const store = memoryStore({
      ...emptyCompletionAssistanceState(), candidates: [candidate()], commands: [command], runs: [run()],
    });
    const fetchImpl: NonNullable<Parameters<typeof synchronizeCompletionAssistance>[0]['fetchImpl']> = async (_url, init) => (
      new Response(JSON.stringify(init?.method === 'POST'
        ? {
            candidate: authoritative, commandId: command.commandId, contractVersion: 1,
            reason: 'run_invalidated', status: 'rejected',
          }
        : {
            candidates: [authoritative], contractVersion: 1, runs: [run()], serverTime: '2026-09-17T12:03:00.000Z',
          }), { status: 200 })
    );
    const result = await synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store, fetchImpl,
    });
    assert.deepEqual(result.state.commands, []);
    assert.deepEqual(result.state.candidates, [authoritative]);
    const restarted = await synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test',
      store: memoryStore(await store.read(owner)), fetchImpl,
    });
    assert.deepEqual(restarted.state.candidates, [authoritative]);
  });

  it('lets same-revision server invalidation close a previously persisted rejected conflict', async () => {
    const authoritative = candidate({ revision: 7, status: 'invalidated', holdReason: 'assignment_changed' });
    const store = memoryStore({
      ...emptyCompletionAssistanceState(), runs: [run()],
      candidates: [candidate({ revision: 7, status: 'held', holdReason: 'server_rejected:run_invalidated' })],
    });
    const result = await synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async () => new Response(JSON.stringify({
        candidates: [authoritative], contractVersion: 1, runs: [run()], serverTime: '2026-09-17T12:03:00.000Z',
      }), { status: 200 }),
    });
    assert.deepEqual(result.state.candidates, [authoritative]);
  });

  it('preserves durable candidates and commands when POST proves the capability unsupported', async () => {
    const command = responseCommand();
    const pendingCandidate = candidate();
    const store = memoryStore({
      ...emptyCompletionAssistanceState(), candidates: [pendingCandidate], commands: [command], runs: [run()],
    });
    const result = await synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async (_url, init) => init?.method === 'POST'
        ? new Response('missing', { status: 404 })
        : new Response('must not reach GET', { status: 500 }),
    });
    assert.equal(result.supported, false);
    assert.equal(result.state.capability, 'unsupported');
    assert.deepEqual(result.state.runs, []);
    assert.deepEqual(result.state.visits, []);
    assert.deepEqual(result.state.candidates, [pendingCandidate]);
    assert.deepEqual(result.state.commands, [command]);
  });

  it('clears active runs when GET proves the capability unsupported', async () => {
    const pendingCandidate = candidate();
    const store = memoryStore({
      ...emptyCompletionAssistanceState(),
      candidates: [pendingCandidate],
      runs: [run()],
      visits: [{
        approached: true,
        assignmentGeneration: '1',
        deliveryStopId: 'stop-1',
        dwellSampleCount: 0,
        evidence: [],
        evidenceOverflow: false,
        runId: 'run-1',
        stage: 'outside',
      }],
    });
    const result = await synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async (_url, init) => {
        assert.equal(init?.method, 'GET');
        return new Response('missing', { status: 404 });
      },
    });
    assert.equal(result.supported, false);
    assert.equal(result.state.capability, 'unsupported');
    assert.deepEqual(result.state.runs, []);
    assert.deepEqual(result.state.visits, []);
    assert.deepEqual(result.state.candidates, [pendingCandidate]);
  });

  it('disables detection for unsafe server policy while preserving actionable candidates and queued responses', async () => {
    const unsafeRun = structuredClone(run()) as CompletionRun;
    unsafeRun.policy.exitRadiusMeters = 50;
    const awaiting = candidate();
    const responded = candidate({
      candidateId: 'candidate-responded',
      response: 'completed',
      responseAt: '2026-09-17T12:02:00.000Z',
      revision: 1,
      status: 'responded',
    });
    const held = candidate({ candidateId: 'candidate-held', holdReason: 'ambiguous', status: 'held' });
    const queuedResponse: Extract<CompletionCommand, { kind: 'response' }> = {
      ...responseCommand(),
      candidateId: responded.candidateId,
    };
    const controlled = controlledMemoryStore({
      ...emptyCompletionAssistanceState(), candidates: [awaiting, responded, held], runs: [run()],
    });
    const result = await synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store: controlled.store,
      fetchImpl: async () => {
        controlled.update((state) => ({ ...state, commands: [queuedResponse] }));
        return new Response(JSON.stringify({
          candidates: [awaiting, responded, held],
          contractVersion: 1,
          runs: [unsafeRun],
          serverTime: '2026-09-17T12:03:00.000Z',
        }), { status: 200 });
      },
    });
    assert.deepEqual(result.state.runs, []);
    assert.deepEqual(result.state.candidates, [awaiting, responded, held]);
    assert.deepEqual(result.state.commands, [queuedResponse]);
  });

  it('marks a valid GET supported before reconcile replays buffered GPS against server policy', async () => {
    const metersToLatitude = (meters: number) => meters / 111_195;
    const at = (seconds: number) => new Date(Date.UTC(2026, 8, 17, 12, 0, seconds)).toISOString();
    const samples = [
      { accuracyMeters: 5, latitude: 37.5 + metersToLatitude(240), longitude: 127, occurredAt: at(0) },
      { accuracyMeters: 5, latitude: 37.5 + metersToLatitude(50), longitude: 127, occurredAt: at(5) },
      { accuracyMeters: 5, latitude: 37.5 + metersToLatitude(45), longitude: 127, occurredAt: at(35) },
      { accuracyMeters: 5, latitude: 37.5 + metersToLatitude(40), longitude: 127, occurredAt: at(65) },
      { accuracyMeters: 5, latitude: 37.5 + metersToLatitude(230), longitude: 127, occurredAt: at(70) },
    ];
    const store = memoryStore({
      ...emptyCompletionAssistanceState(),
      bufferedLocations: [{
        assignmentGeneration: '1', expectedRouteVersionId: '11111111-1111-4111-8111-111111111111', routePlanId: 'route-1', samples,
      }],
      capability: 'unsupported',
    });
    const result = await synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async () => new Response(JSON.stringify({
        candidates: [], contractVersion: 1, runs: [run()], serverTime: '2026-09-17T12:02:00.000Z',
      }), { status: 200 }),
    });
    assert.equal(result.state.capability, 'supported');
    assert.equal(result.state.bufferedLocations, undefined);
    assert.equal(result.state.candidates.length, 1);
  });

  it('applies a pre-run manual outcome to newly fetched server candidates before exposing them', async () => {
    const serverCandidate = candidate();
    const store = memoryStore({
      ...emptyCompletionAssistanceState(),
      manualOutcomes: [{
        assignmentGeneration: '1',
        deliveryStopId: 'stop-1',
        expectedRouteVersionId: '11111111-1111-4111-8111-111111111111',
        occurredAt: '2026-09-17T11:59:00.000Z',
        response: 'completed',
        routePlanId: 'route-1',
      }],
    });
    const result = await synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async () => new Response(JSON.stringify({
        candidates: [serverCandidate],
        contractVersion: 1,
        runs: [run()],
        serverTime: '2026-09-17T12:03:00.000Z',
      }), { status: 200 }),
    });

    assert.equal(result.state.runs[0]?.stops[0]?.status, 'DELIVERED');
    assert.equal(result.state.runs[0]?.stops[0]?.manualResponse?.response, 'completed');
    assert.equal(result.state.candidates[0]?.candidateId, serverCandidate.candidateId);
    assert.equal(result.state.candidates[0]?.status, 'invalidated');
    assert.equal(result.state.candidates[0]?.holdReason, 'stop_terminal');
  });

  it('reconciles canonical runs without reviving local tracking and rejects duplicate identities', async () => {
    const endedRun = { ...run(), trackingEndedAt: '2026-09-17T12:05:00.000Z' };
    const store = memoryStore({ ...emptyCompletionAssistanceState(), runs: [endedRun] });
    const result = await synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async () => new Response(JSON.stringify({
        candidates: [], contractVersion: 1, runs: [run()], serverTime: '2026-09-17T12:06:00.000Z',
      }), { status: 200 }),
    });
    assert.equal(result.state.runs[0]?.trackingEndedAt, endedRun.trackingEndedAt);

    await assert.rejects(synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async () => new Response(JSON.stringify({
        candidates: [candidate(), candidate()], contractVersion: 1,
        runs: [run()], serverTime: '2026-09-17T12:06:00.000Z',
      }), { status: 200 }),
    }), /duplicate candidate/u);
  });

  it('rejects noncanonical assignment identities from server snapshots and ACK candidates', async () => {
    const invalidSnapshots = [
      { candidates: [], runs: [{ ...run(), assignmentGeneration: '01' }] },
      { candidates: [], runs: [{ ...run(), expectedRouteVersionId: 'version-1' }] },
      { candidates: [candidate({ assignmentGeneration: '9223372036854775808' })], runs: [run()] },
      { candidates: [candidate({ expectedRouteVersionId: 'version-1' })], runs: [run()] },
    ];
    for (const invalid of invalidSnapshots) {
      const store = memoryStore(emptyCompletionAssistanceState());
      await assert.rejects(synchronizeCompletionAssistance({
        accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
        fetchImpl: async () => new Response(JSON.stringify({
          ...invalid, contractVersion: 1, serverTime: '2026-09-17T12:06:00.000Z',
        }), { status: 200 }),
      }), /snapshot is malformed/u);
    }

    const command = responseCommand();
    const store = memoryStore({
      ...emptyCompletionAssistanceState(), candidates: [candidate()], commands: [command], runs: [run()],
    });
    await assert.rejects(synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async () => new Response(JSON.stringify({
        candidate: candidate({ assignmentGeneration: '0' }),
        commandId: command.commandId,
        contractVersion: 1,
        status: 'applied',
      }), { status: 200 }),
    }), /ACK is malformed/u);
    assert.deepEqual((await store.read(owner)).commands, [command]);
  });

  it('rejects inferred completion without ordered deadline and auto-processing timestamps', async () => {
    const store = memoryStore(emptyCompletionAssistanceState());
    await assert.rejects(synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async () => new Response(JSON.stringify({
        candidates: [candidate({ status: 'inferred_completed' })],
        contractVersion: 1,
        runs: [run()],
        serverTime: '2026-09-17T12:06:00.000Z',
      }), { status: 200 }),
    }), /snapshot is malformed/u);
  });

  it('requires an authoritative response deadline to equal exit plus exactly 24 hours', async () => {
    const exitAt = Date.parse(candidate().exitAt);
    for (const deltaMs of [-3_600_000, -1, 1, 3_600_000]) {
      const store = memoryStore(emptyCompletionAssistanceState());
      await assert.rejects(synchronizeCompletionAssistance({
        accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
        fetchImpl: async () => new Response(JSON.stringify({
          candidates: [candidate({
            responseDeadlineAt: new Date(exitAt + 24 * 60 * 60 * 1_000 + deltaMs).toISOString(),
          })],
          contractVersion: 1,
          runs: [run()],
          serverTime: '2026-09-17T12:06:00.000Z',
        }), { status: 200 }),
      }), /snapshot is malformed/u);
    }

    const store = memoryStore(emptyCompletionAssistanceState());
    await assert.rejects(synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store,
      fetchImpl: async () => new Response(JSON.stringify({
        candidates: [candidate({ responseDeadlineAt: undefined })],
        contractVersion: 1,
        runs: [run()],
        serverTime: '2026-09-17T12:06:00.000Z',
      }), { status: 200 }),
    }), /snapshot is malformed/u);
  });

  it('bounds response body reads and reports a retryable failure', async () => {
    const store = memoryStore(emptyCompletionAssistanceState());
    await assert.rejects(synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', store, timeoutMs: 5,
      fetchImpl: async () => ({
        json: async () => new Promise(() => undefined),
        ok: true,
        status: 200,
      }) as Response,
    }), CompletionAssistanceSyncRetryError);
  });

  it('suppresses late account mutations after lifecycle cancellation', async () => {
    const lifecycle = new AbortController();
    const store = memoryStore({ ...emptyCompletionAssistanceState(), runs: [run()] });
    let resolveFetch!: (response: Response) => void;
    const request = synchronizeCompletionAssistance({
      accessToken: 'token', accountOwnerHash: owner, baseUrl: 'https://route.test', signal: lifecycle.signal, store,
      fetchImpl: async () => new Promise((resolve) => { resolveFetch = resolve; }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    lifecycle.abort();
    resolveFetch(new Response(JSON.stringify({
      candidates: [], contractVersion: 1, runs: [], serverTime: '2026-09-17T12:03:00.000Z',
    }), { status: 200 }));
    await assert.rejects(request, { name: 'AbortError' });
    assert.deepEqual((await store.read(owner)).runs, [run()]);
  });

  it('stops after a delayed POST when persisted assignment validation changes', async () => {
    const command = responseCommand();
    const original = {
      ...emptyCompletionAssistanceState(), candidates: [candidate()], commands: [command], runs: [run()],
    };
    const store = memoryStore(original);
    let current = true;
    let requestCount = 0;
    let resolvePost!: (response: Response) => void;
    let signalPostStarted!: () => void;
    const postStarted = new Promise<void>((resolve) => { signalPostStarted = resolve; });
    const sync = synchronizeCompletionAssistance({
      accessToken: 'token',
      accountOwnerHash: owner,
      baseUrl: 'https://route.test',
      store,
      validateCurrent: async () => current,
      fetchImpl: async (_url, init) => {
        requestCount += 1;
        assert.equal(init?.method, 'POST');
        signalPostStarted();
        return new Promise((resolve) => { resolvePost = resolve; });
      },
    });
    await postStarted;
    current = false;
    resolvePost(new Response(JSON.stringify({
      commandId: command.commandId, contractVersion: 1, status: 'applied',
    }), { status: 200 }));

    await assert.rejects(sync, { name: 'AbortError' });
    assert.equal(requestCount, 1);
    assert.deepEqual(await store.read(owner), original);
  });
});
