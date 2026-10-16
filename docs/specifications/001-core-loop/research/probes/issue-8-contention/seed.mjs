// Throwaway: makes a disposable git repo under $1 and seeds its store with one
// failing check, "auth > login", using the baseline's own store API (src/).
// Usage: node --import ./register.mjs seed.mjs <dir>
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const src = new URL("../../../../../../src/", import.meta.url);
const { openStore } = await import(new URL("core/store/index.ts", src));
const { worktreeIdFor } = await import(new URL("core/fs/index.ts", src));

const dir = process.argv[2];
mkdirSync(dir, { recursive: true });
const root = realpathSync(dir);
execFileSync("git", ["init", "-q", "-b", "main", root]);
mkdirSync(join(root, "src"), { recursive: true });
writeFileSync(join(root, "src/auth.test.ts"), "// fixture\n");
const commonDir = join(root, ".git");
const store = openStore(commonDir, { busyTimeoutMs: 5_000 });
const id = worktreeIdFor(root);
const check = { kind: "test", project: "", testPath: "src/auth.test.ts", fullName: "auth > login" };
store.worktrees.upsert({ id, root, commonDir, isMain: true, registeredAt: 1, daemon: null });
store.transaction(() =>
  store.revisions.append({
    worktreeId: id, createdAt: Date.now(), head: null, dirty: true, trigger: "watch",
    changes: [{ path: "src/auth.test.ts", oldHash: null, newHash: "h1" }],
  }),
);
store.runs.start({
  id: "run-1", worktreeId: id, revision: 1,
  testFiles: [{ project: "", path: "src/auth.test.ts" }],
  checkpointId: null, logDir: join(commonDir, "squeal", "runs", "run-1"), startedAt: 1,
});
store.results.putMany([{
  check, key: "k0", outcome: "fail", durationMs: 12,
  location: { path: "src/auth.test.ts", line: 3, column: 5 },
  fingerprint: "AssertionError: expected 200 @ src/auth.test.ts:3:5", summary: "expected 200, received 500",
  errors: [], provenance: { worktreeId: id, revision: 1, commit: null, dirty: true, runId: "run-1", recordedAt: Date.now() },
}]);
store.knownStates.upsertMany([{
  worktreeId: id, check, outcome: "fail", validity: "current", pendingPhase: null, observedAt: 1,
  commit: null, origin: { kind: "own" }, durationMs: 12, location: null, summary: "expected 200, received 500", fingerprint: null,
}]);
store.close();
console.log(root);
