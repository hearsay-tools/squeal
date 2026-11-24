// Throwaway research probe. Calls production decisions with synthetic facts; no daemon or store.
import assert from "node:assert/strict";
import { availableParallelism, loadavg } from "node:os";
import { decidePresence } from "../../../../../../src/core/presence/decide.ts";
import { statusView } from "../../../../../../src/core/presence/views.ts";
import { waitView } from "../../../../../../src/core/presence/wait.ts";
import { decideStatusWait } from "../../../../../../src/cli/wait/decide.ts";
import { STATUS_WAITS } from "../../../../../../src/cli/wait/status-table.ts";
import { selectionResult } from "../../../../../../src/cli/verdict.ts";

const cpus = availableParallelism();
const load = loadavg();
console.log(JSON.stringify({ node: process.version, cpus, load }));
assert.ok(load[0] <= cpus, "Host load exceeds CPU count; skip the probe");
const at = 100_000;
const nullFact = () => null;
const verdict = {
  revision: 1,
  testFiles: 1,
  byClass: { current: 1, pending: 0, stale: 0, unknown: 0 },
  unlisted: false,
  failures: { tests: 0, testFiles: 0 },
};
const selection = { verdict, sync: { state: "pending" }, unmatched: 0, notRun: 0 };

for (const ageMs of [9999, 10000, 10001, 23679, 32796, 0]) {
  const record = {
    version: "0.1.627", pid: 1, startedAt: 1, startToken: "synthetic",
    heartbeatAt: at - ageMs, heartbeatIntervalMs: 5000,
  };
  const facts = {
    worktreeId: "synthetic", row: () => ({ daemon: record }),
    shutDown: () => false, exitNoteAt: nullFact, claim: nullFact,
    short: nullFact, rest: nullFact, stop: nullFact, feedDelivered: nullFact,
    marks: nullFact, lockFree: () => false, inFlight: () => [],
  };
  const daemon = statusView(decidePresence(facts, at));
  const step = decideStatusWait(STATUS_WAITS.snapshot, {
    store: "read", daemon: daemon.state, decided: null, hold: null,
  });
  assert.equal(step.kind, "end");
  const snapshot = selectionResult({ ...selection, outcome: step.outcome, snapshot: true });
  const waiting = waitView({
    record, at, marks: nullFact, socket: "listening", deadMs: () => 0,
    recordedAgain: () => true, downMs: 10_000,
  });
  const named = selectionResult({
    ...selection, outcome: "timeout", lapsed: waiting.liveness.state === "lapsed",
  });
  assert.equal(daemon.state, ageMs > 10000 ? "down" : "alive");
  assert.equal(snapshot.reason, ageMs > 10000 ? "no-daemon" : "unsynced");
  assert.equal(named.reason, ageMs > 10000 ? "lapsed" : "unsynced");
  if (ageMs > 10000) assert.equal(daemon.heartbeatLate.ageMs, ageMs);
  console.log(JSON.stringify({ ageMs, daemon, snapshot, waitLiveness: waiting.liveness, named }));
}
console.log("PASS: six synthetic readings; no store, process or socket touched");
