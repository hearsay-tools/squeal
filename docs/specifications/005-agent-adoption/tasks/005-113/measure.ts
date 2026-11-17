// Row 005-113 probe, from 011 `research/probes/unlisted-after-start/owed-delivery.ts`. Times the
// tool-boundary delivery on a synthetic, file-backed store under $TMPDIR, in-process, at the
// source of <src-root> (no daemon, no live store), birth marks on:
//   A. a session registered before the listing (empty view, counts owed); the listing writes
//      N states (inherited passes and FAILS inherited failures); then its first and second
//      tool boundary, each with one own flip as news;
//   B. a session registered after the listing; its first tool boundary.
// Prints one JSON line per round: times in ms and A's view rows after each boundary.
// Run: node_modules/.bin/tsx <this file> <src-root> <N> <rounds>   (never pnpm exec)
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [SRC = ".", NS = "50000", ROUNDS = "5"] = process.argv.slice(2);
const FAILS = Number(process.env.FAILS ?? "32");
const imp = (p: string) => import(pathToFileURL(join(SRC, p)).href);
const { openStore, isStoreOpenFailure } = await imp("src/core/store/open.ts");
const { connectionOf } = await imp("src/core/store/store.ts");
const { ensureBirthMarks } = await imp("src/core/store/state-born.ts");
const { createStateSink } = await imp("src/core/state/sink.ts");
const { createDelivery } = await imp("src/core/delivery/delivery.ts");
const { describeFailure } = await imp("src/core/state/fingerprint.ts");
const { fixedStatus, liveDaemon } = await imp("test/delivery/fakes.ts");

const TESTS_PER_FILE = 45;
const WT = "wt-a";
const OTHER = "wt-b";
const ms = async <T>(f: () => T | Promise<T>) => {
  const t = performance.now();
  const r = await f();
  return [Math.round(performance.now() - t), r] as const;
};

function record(check: { testPath: string }, key: string, outcome: string, worktreeId: string, message = "expected 1 to be 2") {
  const location = { path: check.testPath, line: 1, column: 1 };
  const errors = outcome === "fail" ? [{ name: "AssertionError", message, stack: null, location: { path: "src/a.ts", line: 3, column: 5 }, diff: null }] : [];
  const described = outcome === "fail" ? describeFailure(errors, location) : null;
  return { check, key, outcome, durationMs: 5, location, fingerprint: described?.fingerprint ?? null, summary: described?.summary ?? null, errors,
    provenance: { worktreeId, revision: 0, commit: "c0ffee", dirty: false, runId: "r1", recordedAt: 1_000 } };
}

const n = Number(NS);
for (let round = 0; round < Number(ROUNDS); round++) {
  const base = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "owed-"));
  const common = join(base, ".git");
  mkdirSync(common);
  writeFileSync(join(common, "HEAD"), "ref: refs/heads/main\n");
  const root = join(base, "wt");
  mkdirSync(root);
  writeFileSync(join(root, "squeal.config.json"), JSON.stringify({ baseline: { onStart: "lookup-only" } }));
  const store = openStore(common, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error("open failed");
  ensureBirthMarks(store);
  store.worktrees.upsert({ id: WT, root, commonDir: common, isMain: true, registeredAt: 1, daemon: null });
  liveDaemon(store, WT);
  const sink = createStateSink(store);
  const delivery = createDelivery(store, { status: fixedStatus() });
  const A = { worktreeId: WT, sessionId: "before", agentId: "main" };
  const B = { worktreeId: WT, sessionId: "after", agentId: "main" };
  await delivery.register(A, { atStart: true });
  const keys = [];
  const results = [];
  for (let f = 0; f < Math.ceil(n / TESTS_PER_FILE); f++) {
    const ref = { project: "", path: `src/f${f}.test.ts` };
    keys.push({ worktreeId: WT, testFile: ref, key: `k${f}`, revision: 1, pending: null });
    for (let t = 0; t < TESTS_PER_FILE && f * TESTS_PER_FILE + t < n; t++) {
      const check = { kind: "test", project: "", testPath: ref.path, fullName: `t${t}` };
      const i = f * TESTS_PER_FILE + t;
      results.push(record(check, `k${f}`, i % Math.floor(n / FAILS) === 1 ? "fail" : "pass", OTHER, `inherited ${i}`));
    }
  }
  store.transaction(() => {
    store.testFileKeys.upsertMany(keys);
    store.results.putMany(results);
    sink.applyResults(WT, 0, results, { checkpointId: null });
  });
  const own = { kind: "test", project: "", testPath: "src/f0.test.ts", fullName: "own" };
  let outcome = "pass";
  const flip = () => {
    outcome = outcome === "pass" ? "fail" : "pass";
    const r = record(own, "k0", outcome, WT);
    store.results.putMany([r]);
    sink.applyResults(WT, 0, [r], { checkpointId: null });
  };
  const rows = (id: string) => Number(connectionOf(store).get("SELECT count(*) AS c FROM consumer_views WHERE session_id = ?", id)?.c);
  const load = loadavg()[0].toFixed(1);
  flip();
  const [first, d1] = await ms(() => delivery.onToolBoundary(A));
  const rowsAfterFirst = rows("before");
  flip();
  const [second] = await ms(() => delivery.onToolBoundary(A));
  const [registerAfter] = await ms(() => delivery.register(B, { atStart: true }));
  flip();
  const [boundaryB] = await ms(() => delivery.onToolBoundary(B));
  console.log(JSON.stringify({ round, states: n, load1m: load, firstBoundaryAfterListing: first, countsOwed: d1?.countsOwed !== undefined,
    toldInFirst: d1?.entries.length ?? 0, rowsAfterFirst, secondBoundary: second, registerAfter, boundaryRegisteredAfter: boundaryB }));
  store.close();
  rmSync(base, { recursive: true, force: true });
}
