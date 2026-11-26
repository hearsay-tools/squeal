// Throwaway synthetic probe: no daemon, socket, store or test runner is started.
import assert from "node:assert/strict";
import { groupRequests } from "../../../../../../src/core/daemon/run-group.js";
import { holderText } from "../../../../../../src/cli/group-pending.js";
import { selectionResult, resultCode } from "../../../../../../src/cli/verdict.js";

let release!: () => void;
const startup = new Promise<void>((resolve) => { release = resolve; });
let now = 33_000;
let calls = 0;
const desk = groupRequests(async (_group, held, paths) => {
  held({ kind: "startup", since: 0 });
  await startup; // Mirrors Daemon.#requestGroup's observed gate; not a real daemon.
  calls++;
  assert.deepEqual(paths, ["test/focused.test.ts"]);
  return { revision: 8, queued: 1 };
}, 16, () => null, () => now);
const first = desk.start("tests", ["test/focused.test.ts"]);
now += 60_000; // Virtual elapsed time, not a 60-second wall-clock measurement.
const pending = desk.status(first.requestId)!;
assert.equal(pending.requested, null);
assert.equal(calls, 0);
assert.equal(pending.holder?.kind, "startup");
console.log(JSON.stringify({ phase: "pending", requested: pending.requested,
  holder: pending.holder, message: holderText(pending.holder, null),
  recorded: desk.recorded().length, schedulerCalls: calls }));
const result = selectionResult({ outcome: "timeout", snapshot: true,
  sync: { state: "pending" }, unmatched: 0, notRun: 0,
  verdict: { revision: 7, testFiles: 1, byClass: { current: 1, pending: 0 },
    unlisted: false, failures: { tests: 0, suites: 0, files: 0 } } as never });
assert.deepEqual(result, { result: "none", reason: "unsynced" });
assert.equal(resultCode(result), 3);
console.log(JSON.stringify({ phase: "stored-current-pass-snapshot", ...result, code: resultCode(result) }));
release();
await new Promise((resolve) => setImmediate(resolve));
const accepted = desk.status(first.requestId)!;
assert.deepEqual(accepted.requested, { revision: 8, queued: 1 });
assert.equal(calls, 1);
console.log(JSON.stringify({ phase: "released", requested: accepted.requested,
  holder: accepted.holder, schedulerCalls: calls }));
