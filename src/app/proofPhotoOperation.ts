import type { ProofMediaUploadResult } from '../domain/proof/proofMediaUpload';
import type { ProofPhotoCaptureResult } from '../domain/proof/proofPhotoCapture';
import type { LiveRouteChangeState, LiveRouteChangeStore, LiveRouteChangeUiDraft } from '../domain/route/liveRouteChangeStore';

type ProofPhotoLeaseIdentity = {
  accountOwnerHash: string | null;
  accountEpoch: number;
  routePlanId: string | null;
  assignmentGeneration: string | undefined;
};

export function isProofPhotoLeaseCurrent(captured: ProofPhotoLeaseIdentity, current: ProofPhotoLeaseIdentity): boolean {
  return captured.accountOwnerHash === current.accountOwnerHash && captured.accountEpoch === current.accountEpoch
    && captured.routePlanId === current.routePlanId && captured.assignmentGeneration === current.assignmentGeneration;
}

export async function preserveScopedProofPhoto(input: {
  store: LiveRouteChangeStore;
  accountOwnerHash: string;
  state: LiveRouteChangeState;
  uiDraft: LiveRouteChangeUiDraft;
  stopId: string;
  capture: Extract<ProofPhotoCaptureResult, { kind: 'captured' }>;
  result?: ProofMediaUploadResult;
}): Promise<void> {
  await input.store.update(input.accountOwnerHash, input.state.routePlanId, input.state.assignmentGeneration, saved => {
    // Account deletion removes the cache. A late native result must not recreate it.
    if (saved === null) throw new Error('Original photo evidence is no longer available.');
    const state = saved;
    const draft = state.uiDraft ?? input.uiDraft;
    const savedPhoto = draft.proofPhotoResults[input.stopId];
    const startingPhoto = input.uiDraft.proofPhotoResults[input.stopId];
    if (savedPhoto?.kind === 'captured' && savedPhoto.uri !== input.capture.uri
      && (startingPhoto?.kind !== 'captured' || startingPhoto.uri !== savedPhoto.uri)) return state;
    const proofMediaResults = { ...draft.proofMediaResults };
    if (input.result !== undefined) proofMediaResults[input.stopId] = input.result;
    else if (savedPhoto?.kind !== 'captured' || savedPhoto.uri !== input.capture.uri) {
      // A replacement photo cannot reuse the uploaded media of the previous capture.
      delete proofMediaResults[input.stopId];
    }
    return { ...state, uiDraft: { ...draft,
      proofPhotoResults: { ...draft.proofPhotoResults, [input.stopId]: input.capture },
      proofMediaResults,
    } };
  });
}

/** The preservation callback always writes the original account and assignment. */
export async function runProofPhotoOperation(input: {
  isCurrent(): boolean;
  preserve(result?: ProofMediaUploadResult): Promise<void>;
  onCaptured(): void;
  upload(): Promise<ProofMediaUploadResult>;
  onUploaded(result: ProofMediaUploadResult): void;
  onRetryRequired(result: ProofMediaUploadResult): Promise<void>;
}): Promise<ProofMediaUploadResult | null> {
  await input.preserve();
  if (!input.isCurrent()) return null;
  input.onCaptured();
  const result = await input.upload();
  await input.preserve(result);
  if (!input.isCurrent()) return null;
  input.onUploaded(result);
  await input.onRetryRequired(result);
  if (!input.isCurrent()) return null;
  return result;
}
