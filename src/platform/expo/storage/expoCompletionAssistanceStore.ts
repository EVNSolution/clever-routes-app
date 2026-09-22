import * as Crypto from 'expo-crypto';

import {
  createCompletionAssistanceStore,
  type CompletionAssistanceStore,
} from '../../../domain/completion/completionAssistanceSync';
import { getExpoEncryptedEvidenceStore } from './expoOfflineSubmissionQueueStorage';

let completionAssistanceStorePromise: Promise<CompletionAssistanceStore> | null = null;

export function createExpoCompletionAssistanceStore(): Promise<CompletionAssistanceStore> {
  if (completionAssistanceStorePromise === null) {
    completionAssistanceStorePromise = getExpoEncryptedEvidenceStore()
      .then(createCompletionAssistanceStore)
      .catch((error: unknown) => {
        completionAssistanceStorePromise = null;
        throw error;
      });
  }
  return completionAssistanceStorePromise;
}

export async function getCompletionAccountOwnerHash(phoneE164: string): Promise<string> {
  const normalized = phoneE164.trim();
  if (!/^\+[1-9][0-9]{6,14}$/u.test(normalized)) {
    throw new Error('Completion assistance account identity requires a normalized E.164 phone number.');
  }
  return (await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `clever-driver-account:${normalized}`,
  )).toLowerCase();
}
