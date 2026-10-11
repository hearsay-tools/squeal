// Throwaway probe for research/wait-from-store.md (task 001-256). Not product code.
// The factory each probe passes to `vi.mock` for the scheduler's re-key record:
// the real record, then the prototype, in the same commit transaction.
import type * as Record from "../../../../../../src/core/scheduler/rekeyed-record.js";

export async function shadowedRecord(importOriginal: () => Promise<typeof Record>) {
  const actual = await importOriginal();
  const { recordShadow } = await import("./shadow.js");
  return {
    ...actual,
    recordRekeyed: (...args: Parameters<typeof actual.recordRekeyed>) => {
      actual.recordRekeyed(...args);
      recordShadow(...args);
    },
  };
}
