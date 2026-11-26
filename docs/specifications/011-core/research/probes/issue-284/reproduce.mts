// Throwaway source-level delivery probe; no daemon, runner, or linter is started.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { readPolicy } from "../../../../../../src/core/daemon/policy.js";
import { worktreeIdFor } from "../../../../../../src/core/fs/git-layout.js";
import { writeCursor, writeKeying } from "../../../../../../src/core/lint/pass/records.js";
import { openLintStore } from "../../../../../../src/core/lint/store/open.js";
import { openStore } from "../../../../../../src/core/store/open.js";
import { stop } from "../../../../../../src/harness/codex/handlers.js";
import { openContext } from "../../../../../../src/harness/shared/context.js";

const load = readFileSync("/proc/loadavg", "utf8").trim();
console.log(JSON.stringify({ node: process.version, loadavg: load, cpus: cpus().length }));
if (Number(load.split(" ")[0]) > cpus().length) {
  console.log("SKIP: one-minute load exceeds CPU count");
  process.exit(0);
}
const root = mkdtempSync(join(tmpdir(), "squeal-issue-284-"));
const commonDir = join(root, ".git");
mkdirSync(commonDir);
writeFileSync(join(commonDir, "HEAD"), "ref: refs/heads/main\n");
writeFileSync(join(root, "squeal.config.json"), JSON.stringify({
  lint: { enabled: true, blocking: false }, complexity: { enabled: false },
  stop: { waitMs: 0, blockOnKnownFailures: false, requireFullSuite: false },
}));
const store = openStore(commonDir);
if ("reason" in store) throw new Error(store.reason);
const lint = openLintStore(commonDir, readPolicy(root));
if ("reason" in lint) throw new Error(lint.reason);
try {
  const worktreeId = worktreeIdFor(root);
  store.worktrees.upsert({ id: worktreeId, root, commonDir, isMain: true, registeredAt: Date.now(), daemon: null });
  const revise = () => store.revisions.append({ worktreeId, createdAt: Date.now(), head: null,
    dirty: true, trigger: "watch", changes: [{ path: "eslint.config.js", oldHash: null, newHash: "synthetic" }] });
  revise();
  store.testFileKeys.upsertMany([{ worktreeId, testFile: { project: "", path: "clean.test.js" },
    key: "synthetic-test", revision: 1, pending: null }]);
  store.knownStates.upsertMany([{ worktreeId, check: { kind: "file", project: "", testPath: "clean.test.js" },
    outcome: "pass", validity: "current", pendingPhase: null, observedAt: 1, commit: null,
    origin: { kind: "own" }, durationMs: 1, location: null, summary: null, fingerprint: null }]);
  // A fresh heartbeat prevents unrelated liveness news. No process listens here.
  store.worktrees.setDaemon(worktreeId, { socketPath: join(root, "absent.sock"),
    startedAt: Date.now(), heartbeatAt: Date.now(), heartbeatIntervalMs: 3600000, squealVersion: "0.1.636" });
  const keyed = (mode: "first" | "config", revision: number) => {
    writeCursor(lint.meta, worktreeId, { revision, environment: `synthetic-${revision}` });
    writeKeying(lint.meta, worktreeId, { mode, revision, at: Date.now(), transition: 0 });
    lint.states.upsertMany([{ worktreeId, check: { kind: "lint", path: "clean.js", tool: "eslint" },
      outcome: "pass", stale: false, reason: null, changedAt: revision,
      judged: { key: `synthetic-${revision}`, outcome: "pass", fingerprint: null, blob: "clean", revision } }]);
  };
  keyed("first", 1);
  const input = { session_id: "issue-284-probe", cwd: root, hook_event_name: "Stop", stop_hook_active: false };
  const location = { root, commonDir };
  const context = openContext(input, location);
  assert(context);
  const registered = await context.delivery.register(context.consumer, { inTurn: true });
  context.close();
  assert.equal(registered.knownFailures.length, 0);
  assert.equal(registered.lint?.failing, 0);
  revise();
  keyed("config", 2);
  const deps = { env: {}, ensureDaemon: async () => "alive" as const };
  const first = await stop(input, location, deps);
  console.log("FIRST_STOP", JSON.stringify(first));
  assert(first && "decision" in first && first.decision === "block");
  assert.match(JSON.stringify(first), /Lint config changed: 0 files with findings now/);
  assert.match(JSON.stringify(first), /Known failures: 0/);
  const second = await stop({ ...input, stop_hook_active: true }, location, deps);
  const third = await stop(input, location, deps);
  console.log("CONTINUATION_STOP", JSON.stringify(second));
  console.log("LATER_STOP", JSON.stringify(third));
  assert.equal(second, null);
  assert.equal(third, null);
  console.log("PASS: zero-finding config summary blocks once through the real Codex Stop handler");
} finally {
  lint.close();
  store.close();
  rmSync(root, { recursive: true, force: true });
}
