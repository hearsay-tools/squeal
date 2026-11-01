// Throwaway research probe. No runner, daemon, or product tests are started.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { namedSnapshotCommand } from "../../../../../../src/cli/status-paths.js";
import { worktreeIdFor } from "../../../../../../src/core/fs/index.js";
import { isStoreOpenFailure, openStore } from "../../../../../../src/core/store/index.js";
import type { SyncState } from "../../../../../../src/cli/status-sync.js";

const root = mkdtempSync("/tmp/squeal-issue132-");
const commonDir = join(root, ".git");
mkdirSync(commonDir);
writeFileSync(join(commonDir, "HEAD"), "ref: refs/heads/main\n");
const store = openStore(commonDir);
if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
const now = Date.now();
const id = worktreeIdFor(root);
const path = "sample.test.ts";
try {
  store.worktrees.upsert({
    id, root, commonDir, isMain: true, registeredAt: now,
    daemon: {
      socketPath: "/tmp/unused-issue132.sock", startedAt: now,
      heartbeatAt: now, heartbeatIntervalMs: 5000,
      squealVersion: "0.1.389", token: "probe",
    },
  });
  store.testFileKeys.upsertMany([{
    worktreeId: id, testFile: { project: "", path },
    key: "inherited-key", revision: 0, pending: null,
  }]);
  store.knownStates.upsertMany([{
    worktreeId: id,
    check: { kind: "test", project: "", testPath: path, fullName: "passes" },
    outcome: "pass", validity: "current", pendingPhase: null, observedAt: 0,
    commit: null, origin: { kind: "inherited", worktreeId: "other-tree", commit: "a".repeat(40) },
    durationMs: 1, location: null, summary: null, fingerprint: null,
  }]);
  assert.equal(store.revisions.latest(id), null);
  for (const sync of [
    { state: "pending" },
    { state: "synced", revision: 0, incarnation: null },
    { state: "synced", revision: 1, incarnation: null },
  ] satisfies SyncState[]) {
    let stdout = "";
    let stderr = "";
    const code = await namedSnapshotCommand([path], { json: true }, {
      cwd: root, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; },
    }, {
      now: () => now, settleMs: 0,
      sync: () => ({ current: () => sync, stop() {} }),
    });
    const payload = JSON.parse(stdout);
    assert.equal(payload.revision, 0);
    assert.equal(payload.inheritedCount, 1);
    assert.equal(payload.selection.testFiles[0].state, "current");
    assert.equal(payload.selection.testFiles[0].verdict, "pass");
    assert.equal(code, sync.state === "synced" && sync.revision === 0 ? 0 : 3);
    console.log(JSON.stringify({
      sync, code, revision: payload.revision, inheritedCount: payload.inheritedCount,
      notes: payload.notes, selection: payload.selection, stderr,
    }));
  }
  assert.equal(store.revisions.latest(id), null);
  console.log("PASS: pending sync gives none; synced revision 0 gives pass; later sync gives none; no local revision or test run.");
} finally {
  store.close();
  rmSync(root, { recursive: true, force: true });
}
