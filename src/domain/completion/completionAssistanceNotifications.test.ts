import assert from 'node:assert/strict';
import { it } from 'node:test';
import { notifyCompletionCandidates } from './completionAssistanceNotifications';

it('claims a candidate durably before notification and does not notify twice after restart', async () => {
  let state: any = { candidates: [{ candidateId: 'one', status: 'awaiting_response' }] };
  const calls: string[] = [];
  const store: any = {
    read: async () => state,
    update: async (_: string, mutate: any) => { state = mutate(state); return state; },
  };
  const notify = async (candidate: any) => {
    assert.equal(state.candidates[0].notified, true);
    calls.push(candidate.candidateId);
  };
  await notifyCompletionCandidates({ store, accountOwnerHash: 'account', notify });
  await notifyCompletionCandidates({ store, accountOwnerHash: 'account', notify });
  assert.deepEqual(calls, ['one']);
});

it('never notifies when persistence fails or the candidate already has a response', async () => {
  let notified = false;
  await assert.rejects(notifyCompletionCandidates({
    accountOwnerHash: 'account',
    notify: async () => { notified = true; },
    store: { update: async () => { throw new Error('disk full'); } } as any,
  }), /disk full/);
  assert.equal(notified, false);
  const state: any = { candidates: [{ candidateId: 'one', status: 'responded', response: 'not_completed' }] };
  await notifyCompletionCandidates({
    accountOwnerHash: 'account', notify: async () => { notified = true; },
    store: { update: async (_: string, mutate: any) => mutate(state) } as any,
  });
  assert.equal(notified, false);
});

it('a failed OS notification leaves the durable inbox and does not replay an uncertain delivery', async () => {
  let state: any = { candidates: [{ candidateId: 'one', status: 'awaiting_response' }] };
  let attempts = 0;
  const input: any = {
    accountOwnerHash: 'account',
    store: { update: async (_: string, mutate: any) => { state = mutate(state); return state; } },
    notify: async () => { attempts++; throw new Error('OS response lost'); },
  };
  await notifyCompletionCandidates(input);
  await notifyCompletionCandidates(input);
  assert.equal(attempts, 1);
  assert.equal(state.candidates[0].status, 'awaiting_response');
});

it('also prompts held visits once so the driver can explicitly resolve uncertain evidence', async () => {
  let state: any = { candidates: [{ candidateId: 'held', status: 'held', holdReason: 'evidence_limit_exceeded' }] };
  let attempts = 0;
  const input: any = {
    accountOwnerHash: 'account',
    store: { update: async (_: string, mutate: any) => { state = mutate(state); return state; } },
    notify: async () => { attempts++; },
  };
  await notifyCompletionCandidates(input);
  await notifyCompletionCandidates(input);
  assert.equal(attempts, 1);
});

it('does not display an old account notification if the account changes during persistence', async () => {
  let current = true;
  let attempts = 0;
  const state: any = { candidates: [{ candidateId: 'old', status: 'awaiting_response' }] };
  await notifyCompletionCandidates({
    accountOwnerHash: 'old-account',
    validateCurrent: async () => current,
    store: { update: async (_, mutate) => { current = false; return mutate(state); } },
    notify: async () => { attempts++; },
  });
  assert.equal(attempts, 0);
});
