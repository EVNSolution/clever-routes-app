import type { CompletionCandidate } from './completionAssistance';
import type { CompletionAssistanceStore } from './completionAssistanceSync';

export async function notifyCompletionCandidates(input: {
  store: Pick<CompletionAssistanceStore, 'update'>;
  accountOwnerHash: string;
  notify(candidate: CompletionCandidate): Promise<void>;
  isCurrent?: () => boolean;
  validateCurrent?: () => Promise<boolean>;
}): Promise<void> {
  if (input.validateCurrent !== undefined && !await input.validateCurrent()) return;
  const claimed: CompletionCandidate[] = [];
  await input.store.update(input.accountOwnerHash, (state) => {
    if (input.isCurrent?.() === false) return state;
    return {
      ...state,
      candidates: state.candidates.map((candidate) => {
        if (candidate.notified || candidate.response !== undefined
          || (candidate.status !== 'awaiting_response' && candidate.status !== 'held')) return candidate;
        claimed.push(candidate);
        return { ...candidate, notified: true };
      }),
    };
  });
  for (const candidate of claimed) {
    if (input.isCurrent?.() === false) break;
    if (input.validateCurrent !== undefined && !await input.validateCurrent()) break;
    // The OS and SQLite cannot commit atomically. Claim once; the durable inbox
    // remains available if the process dies or notification delivery is denied.
    await input.notify(candidate).catch(() => undefined);
  }
}
