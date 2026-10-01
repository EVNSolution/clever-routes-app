import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDiagnosticBindingPersistence } from './diagnosticBindingPersistence';
test('late logout delete reconciles the newer active account binding', async () => {
  let finishDelete!: () => void; let stored: string | null = 'A';
  const store = createDiagnosticBindingPersistence(value => value === null ? new Promise<void>(resolve => { finishDelete = () => { stored = null; resolve(); }; }) : Promise.resolve().then(() => { stored = value; }));
  const clear = store.persist(null);
  await store.persist('B'); assert.equal(stored, 'B');
  finishDelete(); await clear; assert.equal(stored, 'B');
});
test('a hung old binding write does not prevent a later account binding', async () => {
  let finishOld!: () => void; let stored: string | null = null;
  const store = createDiagnosticBindingPersistence(value => value === 'A' ? new Promise<void>(resolve => { finishOld = () => { stored = 'A'; resolve(); }; }) : Promise.resolve().then(() => { stored = value; }));
  const old = store.persist('A'); await store.persist('B'); assert.equal(stored, 'B');
  finishOld(); await old; assert.equal(stored, 'B');
});
