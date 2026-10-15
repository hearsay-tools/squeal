// Builds a ~200 MB fixture store with ~20,000 checks in its main worktree (task 001-414).
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDelivery } from "../../../../../../src/core/delivery/index.js";
import { createStateSink, describeFailure } from "../../../../../../src/core/state/index.js";
import { isStoreOpenFailure, openStore } from "../../../../../../src/core/store/index.js";

const dir = process.argv[2]!;
const commonDir = join(dir, ".git");
mkdirSync(commonDir, { recursive: true });
writeFileSync(join(commonDir, "HEAD"), "ref: refs/heads/main\n");
const store = openStore(commonDir, { busyTimeoutMs: 10_000 });
if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
const MAIN = "wt-main";
const FILES = 1000, PER = 20, OTHERS = 12;
const wts = [MAIN, ...Array.from({ length: OTHERS }, (_, i) => `wt-${i}`)];
for (const id of wts)
  store.worktrees.upsert({ id, root: join(dir, id), commonDir, isMain: id === MAIN, registeredAt: 1, daemon: null });
const pad = "x".repeat(400);
let revision = 0;
const sink = createStateSink(store, { now: () => 1_000 + revision });
const size = () => statSync(join(commonDir, "squeal", "store.sqlite")).size;
let round = 0;
for (;;) {
  revision++;
  for (const wt of round === 0 ? wts : [MAIN, wts[1 + (round % OTHERS)]!]) {
    for (let f = 0; f < FILES; f++) {
      const file = { project: "", path: `src/f${f}.test.ts` };
      const key = `k-${f}-${round}`;
      store.testFileKeys.upsertMany([{ worktreeId: wt, testFile: file, key, revision, pending: null }]);
      const results = Array.from({ length: PER }, (_, t) => {
        const check = { kind: "test" as const, project: "", testPath: file.path, fullName: `f${f} t${t}` };
        const fail = (f * PER + t + round) % 50 === 0;
        const errors = fail ? [{ name: "AssertionError", message: `expected ${round} ${pad}`, stack: pad + pad, location: { path: file.path, line: 3, column: 5 }, diff: null }] : [];
        const location = { path: file.path, line: t + 1, column: 1 };
        const described = fail ? describeFailure(errors, location) : null;
        return {
          check, key, outcome: fail ? ("fail" as const) : ("pass" as const), durationMs: 5, location,
          fingerprint: described?.fingerprint ?? null, summary: described?.summary ?? null, errors,
          provenance: { worktreeId: wt, revision, commit: "c0ffee", dirty: false, runId: `run-${round}`, recordedAt: 1_000 + revision },
        };
      });
      store.transaction(() => sink.applyResults(wt, revision, results, { checkpointId: null }));
    }
  }
  round++;
  const s = size();
  console.log("round", round, "size MB", (s / 1e6).toFixed(1));
  if (s >= 200e6) break;
}
const delivery = createDelivery(store, { status: { build: async () => { throw new Error("no"); } } as never, now: () => 5_000 });
const consumer = { worktreeId: MAIN, sessionId: "s1", agentId: "main" };
await delivery.register(consumer);
await delivery.endTurn(consumer);
console.log("known states in main:", store.knownStates.list(MAIN).length);
store.close();
