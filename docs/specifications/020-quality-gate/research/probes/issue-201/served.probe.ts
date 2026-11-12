import { appendFileSync } from "node:fs";
import { it, expect } from "vitest";
import { BOTH, KEY_A, KEY_B, kept, resultsAt, served, countGateWrites } from "../../../../../../test/code/gate/keep-daemon-kit.js";

// Throwaway: real socket handlers and keepInDaemon; no full daemon or runner.
it("the serving daemon path still drops files at the busy bound", async () => {
  const at = await served();
  const locked = at.hold();
  const notes: string[] = [];
  const count = countGateWrites();
  const started = Date.now();
  try {
    await kept(at, notes, { files: BOTH, busyBoundMs: 600 });
  } finally {
    locked.release();
  }
  const evidence = {
    ms: Date.now() - started,
    gateWriteTransactions: count.stop(),
    requests: at.keeps.map((r) => r.write.kind),
    rowsAfterRelease: [resultsAt(at.commonDir, KEY_A), resultsAt(at.commonDir, KEY_B)],
    notes,
  };
  appendFileSync(process.env.ISSUE201_OUT!, `[issue-201] served busy: ${JSON.stringify(evidence, null, 1)}\n`);
  expect(evidence.gateWriteTransactions).toBe(0);
  expect(evidence.rowsAfterRelease).toEqual([0, 0]);
  expect(notes.at(-1)).toContain("2 completed test files were not kept");
});
