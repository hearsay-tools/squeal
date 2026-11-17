// Row 005-106 probe (throwaway, kept as evidence): a registration's view write and a delivery's
// reads on a worktree of 32,000 known states (32 failing), with the full copy (before) and with
// the non-pass seed and the birth mark (after). Each registration write is rolled back. Writes
// only under the directory it is given. Usage:
//   node_modules/.bin/tsx docs/specifications/005-agent-adoption/tasks/005-106/measure.ts <scratch-dir> [rounds]
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { planDelta } from "../../../../../src/core/delivery/delta.js";
import { markedView, recordViewMark, registrationSeed } from "../../../../../src/core/delivery/view-mark.js";
import { isStoreOpenFailure, openStore } from "../../../../../src/core/store/open.js";
import { currentBirthMark, ensureBirthMarks } from "../../../../../src/core/store/state-born.js";
import { seedView, statesToSeed } from "../../../../../src/core/store/view-seed.js";
import { ensureWriteMarkers } from "../../../../../src/core/store/write-markers.js";
import type { Consumer } from "../../../../../src/core/types/delivery.js";
import type { KnownState } from "../../../../../src/core/types/state.js";

const [scratch, roundsArg] = process.argv.slice(2);
if (scratch === undefined) throw new Error("usage: measure.ts <scratch-dir> [rounds]");
const rounds = Number(roundsArg ?? 15);
const commonDir = mkdtempSync(join(scratch, "view-"));
mkdirSync(commonDir, { recursive: true });
writeFileSync(join(commonDir, "HEAD"), "ref: refs/heads/main\n");
const store = openStore(commonDir, { busyTimeoutMs: 10_000 });
if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));

const WT = "wt-1";
const state = (i: number): KnownState => ({
  worktreeId: WT,
  check: { kind: "test", project: "", testPath: `src/t${i % 400}.test.ts`, fullName: `case ${i}` },
  outcome: i % 1000 === 0 ? "fail" : "pass",
  validity: "current",
  pendingPhase: null,
  observedAt: 1,
  commit: null,
  origin: { kind: "own" },
  durationMs: 3,
  location: null,
  summary: null,
  fingerprint: i % 1000 === 0 ? `Error: ${i}` : null,
});
store.knownStates.upsertMany(Array.from({ length: 32_000 }, (_, i) => state(i)));
ensureWriteMarkers(store);
ensureBirthMarks(store);

const FULL: Consumer = { worktreeId: WT, sessionId: "full", agentId: "main" };
const MARKED: Consumer = { worktreeId: WT, sessionId: "marked", agentId: "main" };
const ROLLBACK = new Error("rollback");
const ms = (fn: () => void) => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};
/** `fn` timed inside a transaction that is then rolled back. */
const rolledBack = (fn: () => void) => {
  let took = 0;
  try {
    store.transaction(() => {
      took = ms(fn);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return took;
};
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.ceil(s.length * q) - 1)] ?? NaN;
  return `median ${at(0.5).toFixed(1)} ms, p90 ${at(0.9).toFixed(1)} ms`;
};

// The two consumers, registered for the delivery reads; 50 states born after the registration.
store.transaction(() => {
  store.consumers.register(FULL, 1);
  store.consumers.register(MARKED, 1);
  const { seed } = statesToSeed(store, WT);
  seedView(store, FULL, seed, 1);
  const { rows, mark } = registrationSeed(store, seed);
  seedView(store, MARKED, rows, 1);
  recordViewMark(store, MARKED, mark === null ? null : { mark, at: 1 });
});
store.knownStates.upsertMany(Array.from({ length: 50 }, (_, i) => state(40_000 + i)));
console.log(`states ${store.knownStates.list(WT).length}, high mark ${currentBirthMark(store)}`);
console.log(`view rows: full ${store.views.list(FULL).length}, marked ${store.views.list(MARKED).length}`);

const times: Record<string, number[]> = {};
const add = (name: string, t: number) => (times[name] ??= []).push(t);
const loads: string[] = [];
for (let r = 0; r < rounds; r++) {
  const { seed } = statesToSeed(store, WT);
  add("registration write, full copy (before)", rolledBack(() => seedView(store, FULL, seed, 2)));
  add(
    "registration write, non-pass seed and mark (after)",
    rolledBack(() => {
      const { rows, mark } = registrationSeed(store, seed);
      seedView(store, MARKED, rows, 2);
      recordViewMark(store, MARKED, mark === null ? null : { mark, at: 2 });
    }),
  );
  add("registration read, states and seed rows (both)", ms(() => statesToSeed(store, WT)));
  let states: readonly KnownState[] = [];
  add("delivery read, states (both)", ms(() => (states = store.knownStates.list(WT))));
  let full = store.views.list(FULL);
  add("delivery read, full view (before)", ms(() => (full = store.views.list(FULL))));
  let marked = store.views.list(MARKED);
  add(
    "delivery read, sparse view and states born after the mark (after)",
    ms(() => (marked = markedView(store, MARKED, store.views.list(MARKED), states))),
  );
  const input = {
    states,
    isBaselineFinding: () => false,
    toldAt: 3,
    rootOf: () => null,
    revision: 1,
  };
  add("planDelta JS, full view (before)", ms(() => planDelta({ ...input, view: full })));
  add("planDelta JS, view through the mark (after)", ms(() => planDelta({ ...input, view: marked })));
  loads.push(loadavg()[0]?.toFixed(1) ?? "?");
}
for (const [name, xs] of Object.entries(times)) console.log(`${name}: ${stats(xs)}`);
console.log(`loads per round: ${loads.join(", ")}`);
store.close();
