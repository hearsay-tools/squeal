// Throwaway probe for issue #45: seeds a real store in a temp dir, then prints
// the checkout's `squeal status` head. Run through run.sh; needs no build.
// zero:   no failures; 10 test files of 10 passing checks each: 6 files stale
//         (key moved, nothing queued), 2 queued (pending), 2 current.
// oldrev: three failures all observed at revision 6, the worktree at 26:
//         `same-key` current (its file's key did not move since 6),
//         `moved-key` stale (key moved, not queued), `queued` pending.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = new URL("../../../../../../src/", import.meta.url);
const { worktreeIdFor } = await import(new URL("core/fs/index.ts", src));
const { openStore, isStoreOpenFailure } = await import(new URL("core/store/index.ts", src));
const { readStatus, formatStatus } = await import(new URL("core/status/index.ts", src));

const scenario = process.argv[2] ?? "zero";
const keepAt = process.argv[3];
const HEAD = 26;

// Each file: validity of all its checks, outcome, names.
const files =
  scenario === "zero"
    ? Array.from({ length: 10 }, (_, i) => ({
        path: `src/f${i}.test.ts`,
        validity: i < 6 ? "stale" : i < 8 ? "pending" : "current",
        outcome: "pass",
        names: Array.from({ length: 10 }, (_, j) => `t${j}`),
        observedAt: 10,
      }))
    : [
        { path: "src/same-key.test.ts", validity: "current", outcome: "fail", names: ["same-key"], observedAt: 6 },
        { path: "src/moved-key.test.ts", validity: "stale", outcome: "fail", names: ["moved-key"], observedAt: 6 },
        { path: "src/queued.test.ts", validity: "pending", outcome: "fail", names: ["queued"], observedAt: 6 },
        { path: "src/ok.test.ts", validity: "current", outcome: "pass", names: ["ok"], observedAt: HEAD },
      ];

const root = keepAt ?? realpathSync(mkdtempSync(join(tmpdir(), "squeal-issue45-")));
try {
  const commonDir = join(root, ".git");
  mkdirSync(commonDir);
  writeFileSync(join(commonDir, "HEAD"), "ref: refs/heads/main\n");
  const id = worktreeIdFor(root);
  const store = openStore(commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
  store.worktrees.upsert({ id, root, commonDir, isMain: true, registeredAt: 1, daemon: null });
  store.transaction(() => {
    for (let n = 1; n <= HEAD; n++) {
      store.revisions.append({
        worktreeId: id, createdAt: n, head: null, dirty: true, trigger: "watch",
        changes: [{ path: "src/run.ts", oldHash: null, newHash: `h${n}` }],
      });
    }
  });
  store.testFileKeys.upsertMany(
    files.map((f) => ({
      worktreeId: id,
      testFile: { project: "", path: f.path },
      key: `k-${f.path}-${f.validity === "current" ? "old" : "new"}`,
      revision: f.validity === "current" ? f.observedAt : HEAD,
      pending: f.validity === "pending" ? "queued" : null,
    })),
  );
  store.knownStates.upsertMany(
    files.flatMap((f) =>
      f.names.map((name) => ({
        worktreeId: id,
        check: { kind: "test", project: "", testPath: f.path, fullName: name },
        outcome: f.outcome,
        validity: f.validity,
        pendingPhase: f.validity === "pending" ? "queued" : null,
        observedAt: f.observedAt,
        commit: null,
        origin: { kind: "own" },
        durationMs: 5,
        location: null,
        summary: f.outcome === "fail" ? "AssertionError: expected 1 to be 2" : "",
        fingerprint: f.outcome === "fail" ? "f" : null,
      })),
    ),
  );
  store.close();

  const status = readStatus(root, { now: () => 1_000 });
  console.log(`== scenario ${scenario}`);
  console.log("-- status --json counts:", JSON.stringify(status.counts));
  console.log("-- status --json knownFailureCounts:", JSON.stringify(status.knownFailureCounts));
  console.log("-- squeal status (lines before the blank line):");
  console.log(formatStatus(status, 1_000).split("\n\n")[0]);
} finally {
  if (keepAt === undefined) rmSync(root, { recursive: true, force: true });
}
