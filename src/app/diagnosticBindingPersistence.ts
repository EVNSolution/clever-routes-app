/** Late native mutations reconcile to the newest intent without blocking later calls. */
export function createDiagnosticBindingPersistence(write: (value: string | null) => Promise<void>) {
  let revision = 0;
  let desired: string | null = null;
  async function apply(value: string | null, expected: number): Promise<void> {
    try { await write(value); }
    finally { if (expected !== revision) await apply(desired, revision); }
  }
  return { persist: (value: string | null): Promise<void> => { desired = value; return apply(value, ++revision); } };
}
