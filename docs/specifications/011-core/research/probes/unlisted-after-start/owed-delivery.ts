// Throwaway probe (011-385). Times the tool-boundary delivery on a synthetic, file-backed store
// under $TMPDIR, in-process, at this worktree's source (no daemon, no live store):
//   A. a session registered before the listing (empty view, counts owed); the listing writes
//      N states (inherited passes, as cezar's are); then its first and second tool boundary;
//   B. a session registered after the listing; its first tool boundary.
// Run: node_modules/.bin/tsx <this file> <src-root> <N>[,<N>...]   (never pnpm exec)
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [SRC, NS = "5000,20000,50000"] = process.argv.slice(2);
const imp = (p: string) => import(pathToFileURL(join(SRC, p)).href);
const { openStore, isStoreOpenFailure } = await imp("src/core/store/open.ts");
const { ensureBirthMarks } = await imp("src/core/store/state-born.ts");
const { createStateSink } = await imp("src/core/state/sink.ts");
const { createDelivery } = await imp("src/core/delivery/delivery.ts");
const { fixedStatus, liveDaemon } = await imp("test/delivery/fakes.ts");

const TESTS_PER_FILE = 45; // cezar: 76,636 rows median at listing / ~1,300 files (inferred shape)
const WT = "wt-a", OTHER = "wt-b";
const ms = async (f: () => unknown) => { const t = performance.now(); const r = await f(); return [performance.now() - t, r] as const; };

for (const n of NS.split(",").map(Number)) {
  const base = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "owed-"));
  const common = join(base, ".git"); mkdirSync(common); writeFileSync(join(common, "HEAD"), "ref: refs/heads/main\n");
  const root = join(base, "wt"); mkdirSync(root);
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
  const [regA] = await ms(() => delivery.register(A, { atStart: true }));
  // The listing: keys for every file, then the inherited results as one sink commit.
  const files = Math.ceil(n / TESTS_PER_FILE);
  const keys = [], results = [];
  for (let f = 0; f < files; f++) {
    const ref = { project: "", path: `src/f${f}.test.ts` };
    keys.push({ worktreeId: WT, testFile: ref, key: `k${f}`, revision: 1, pending: null });
    for (let t = 0; t < TESTS_PER_FILE && f * TESTS_PER_FILE + t < n; t++) {
      results.push({ check: { kind: "test", project: "", testPath: ref.path, fullName: `t${t}` }, key: `k${f}`, outcome: "pass",
        durationMs: 5, location: { path: ref.path, line: 1, column: 1 }, fingerprint: null, summary: null, errors: [],
        provenance: { worktreeId: OTHER, revision: 0, commit: "c0ffee", dirty: false, runId: "r1", recordedAt: 1_000 } });
    }
  }
  const [listMs] = await ms(() => store.transaction(() => { store.testFileKeys.upsertMany(keys); store.results.putMany(results); sink.applyResults(WT, 0, results, { checkpointId: null }); }));
  // NEWS=1: before each boundary one own check flips, so each delivery has a transition to tell.
  const own = { kind: "test", project: "", testPath: "src/f0.test.ts", fullName: "own" };
  const { describeFailure } = await imp("src/core/state/fingerprint.ts");
  let outcome = "pass";
  const flip = () => { if (process.env.NEWS !== "1") return; outcome = outcome === "pass" ? "fail" : "pass";
    const location = { path: own.testPath, line: 1, column: 1 };
    const errors = outcome === "fail" ? [{ name: "AssertionError", message: "expected 1 to be 2", stack: null, location: { path: "src/a.ts", line: 3, column: 5 }, diff: null }] : [];
    const described = outcome === "fail" ? describeFailure(errors, location) : null;
    const r = { check: own, key: "k0", outcome, durationMs: 5, location, fingerprint: described?.fingerprint ?? null, summary: described?.summary ?? null, errors,
      provenance: { worktreeId: WT, revision: 0, commit: "c0ffee", dirty: false, runId: "r2", recordedAt: 2_000 } };
    store.results.putMany([r]); sink.applyResults(WT, 0, [r], { checkpointId: null }); };
  const { formatDelta } = await imp("src/core/delivery/format.ts");
  flip();
  const [a1, d1] = await ms(() => delivery.onToolBoundary(A));
  flip();
  const [a2, d2] = await ms(() => delivery.onToolBoundary(A));
  const [regB] = await ms(() => delivery.register(B, { atStart: true }));
  flip();
  const [b1, e1] = await ms(() => delivery.onToolBoundary(B));
  if (process.env.SHOW === "1") console.log(d1 && formatDelta(d1).split("\n").slice(0, 3).join("\n"));
  const views = (id: string) => (store as any).db?.prepare?.("select count(*) c from consumer_views where session_id=?").get(id)?.c ?? "?";
  console.log(JSON.stringify({ states: n, files, listMs: Math.round(listMs), registerBeforeMs: Math.round(regA),
    firstBoundaryAfterListingMs: Math.round(a1), firstText: d1 === null ? "silent" : d1.countsOwed ? "news+counts" : "news", secondText: d2 === null ? "silent" : "news", bText: e1 === null ? "silent" : "news", secondBoundaryMs: Math.round(a2),
    registerAfterMs: Math.round(regB), boundaryRegisteredAfterMs: Math.round(b1) }));
  store.close(); rmSync(base, { recursive: true, force: true });
}
