// Throwaway synthetic probe. No runner, daemon, real store or host overload.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? ".");
const source = (path: string) => import(pathToFileURL(resolve(root, path)).href);
const { askRetry, readRetries } = await source("src/core/retry/records.ts");
const { takeRetries, endRetry, tierLoad, recordFailedLoad } = await source("src/core/scheduler/retries.ts");
const { newFileState } = await source("src/core/scheduler/files.ts");
const { readRunLoads, loadAllows } = await source("src/core/retry/load.ts");

const meta = new Map<string, string>();
const file = newFileState({ project: "", path: "test/synthetic-timeout.test.ts" });
file.key = file.resultKey = "unchanged-key";
file.failing = true;
const store = {
  meta: { get: (key: string) => meta.get(key) ?? null, set: (key: string, value: string) => meta.set(key, value) },
  transaction: (fn: () => unknown) => fn(),
  testFileKeys: { withKey: () => [{ testFile: file.ref }] },
  worktrees: { get: () => null },
};
let now = 1_800_000_000_000;
let oneMinute = 69.6;
let queued = 0;
let claimed = 0;
const notes: string[] = [];
const context = { store, worktreeId: "probe", now: () => now, hostLoad: () => ({ oneMinute, cpus: 24 }), note: (note: string) => notes.push(note) };
const ledger = {
  files: new Map([[file.id, file]]),
  file: () => file,
  enqueue: (_file: unknown, _priority: unknown, forced: boolean) => { assert.equal(forced, true); queued++; },
  dequeue: () => false,
};
const ask = (reason: string, session = "same-session", key = file.key) => askRetry(store, { testFile: file.ref, key, session, reason, at: now, worktreeId: "probe" });
const take = () => takeRetries(context, ledger, () => { claimed++; });
assert.equal(ask("load").kind, "queued");
assert.equal(take(), false);
assert.equal(readRetries(store)[0].gateClosedAt, now);
now += 599_999;
assert.equal(take(), false);
assert.equal(queued, 0);
now++;
assert.equal(take(), true);
assert.equal(queued, 1);
assert.equal(claimed, 1);
assert.equal(notes.length, 1);
assert.match(notes[0], /2\.90 per CPU/);
console.log(JSON.stringify({ phase: "cap", elapsedMs: 600_000, oneMinute, cpus: 24, queued, note: notes[0] }));

// Supply the failing result and tier-start load a real runner would return.
const results = [{ outcome: "fail" }];
recordFailedLoad(context, "synthetic-failed-run", tierLoad(context), results);
endRetry(context, file, file.key, results, "synthetic-failed-run");
assert.equal(readRetries(store)[0].end.outcome, "failed");
assert.equal(readRunLoads(store).get("synthetic-failed-run"), 2.9);
oneMinute = 12;
assert.equal(loadAllows(context.hostLoad()), true);
assert.equal(take(), false);
const loadAgain = ask("load").kind;
const environmentAgain = ask("environment").kind;
assert.equal(loadAgain, "spent");
assert.equal(environmentAgain, "spent");
assert.equal(queued, 1);
console.log(JSON.stringify({ phase: "calm", oneMinute, cpus: 24, loadAgain, environmentAgain, queued, recordedRunLoad: readRunLoads(store).get("synthetic-failed-run") }));

// A new scheduler context over the same persisted row cannot reset the budget.
const restoredStore = { ...store, meta: { ...store.meta } };
assert.equal(askRetry(restoredStore, { testFile: file.ref, key: file.key, session: "same-session", reason: "load", at: now, worktreeId: "probe" }).kind, "spent");
// Control cases establish the exact key/session scope, not a permanent file ban.
assert.equal(ask("load", "later-session").kind, "queued");
assert.equal(ask("load", "same-session", "changed-key").kind, "queued");
console.log(JSON.stringify({ phase: "controls", restoredStoreSameSession: "spent", laterSession: "queued", changedKey: "queued", verdict: "synthetic mechanism reproduced" }));
