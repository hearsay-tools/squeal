import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import { refinedMetaKey, type TestFileRef } from "../../src/core/types/index.js";
import {
  HOOK_TIMEOUT_MS,
  type HookDeps,
  type HookResult,
  runHook,
  STOP_MARGIN_MS,
  STOP_WAIT_CAP_MS,
  stopBusyTimeoutMs,
} from "../../src/harness/claude-code/index.js";
import { check, result, setKey } from "../state/helpers.js";
import { recorded, type SquealRepo, SUBAGENT, squealRepo } from "./helpers.js";

const SILENT: HookResult = { stdout: "", stderr: "", exitCode: 0 };
const deps = (overrides: Partial<HookDeps> = {}): HookDeps => ({
  env: {},
  ensureDaemon: async () => "alive",
  ...overrides,
});
const json = (out: HookResult): unknown => JSON.parse(out.stdout);

const SLOW_FILE: TestFileRef = { project: "", path: "src/slow.test.ts" };
const SLOW = check("slow > adds slowly", SLOW_FILE);

/** Marks every check of `file` pending at the next revision: its re-run is queued. */
function queue(r: SquealRepo, file: TestFileRef, key: string): void {
  r.apply();
  const revision = r.store.revisions.latest(r.worktreeId)?.number ?? 0;
  r.store.testFileKeys.upsertMany([
    { worktreeId: r.worktreeId, testFile: file, key, revision, pending: "queued" },
  ]);
  r.sink.refresh(r.worktreeId, revision, { checkpointId: null });
}

/** `math > adds` and `slow > adds slowly` fail at revision 1. */
async function twoFailures(): Promise<SquealRepo> {
  const r = squealRepo();
  setKey(r.store, "s1", { file: SLOW_FILE, worktreeId: r.worktreeId });
  r.apply(r.fail(), result(SLOW, "fail", { key: "s1", worktreeId: r.worktreeId, revision: 1 }));
  await runHook("session-start", recorded("session-start", r.root), deps());
  r.policy({ stop: { blockOnKnownFailures: true } });
  return r;
}

describe("Stop with stop.blockOnKnownFailures (review wave 3, S1)", () => {
  it("blocks only on current failures and names pending ones with their last failed revision", async () => {
    const r = await twoFailures();
    queue(r, SLOW_FILE, "s2");

    const out = await runHook("stop", recorded("stop", r.root), deps());

    const { decision, reason } = json(out) as { decision: string; reason: string };
    expect(decision).toBe("block");
    expect(reason.split("\n\n")[0]).toBe(
      "Squeal policy stop.blockOnKnownFailures is on and 1 known failure exists at revision 2: " +
        "src/math.test.ts > math > adds. " +
        "1 check last failed at an earlier revision and its re-run at revision 2 is pending: " +
        "src/slow.test.ts > slow > adds slowly (failed at revision 1).",
    );
  });

  it("does not block when every failure is pending at this revision", async () => {
    const r = await twoFailures();
    queue(r, SLOW_FILE, "s2");
    r.store.testFileKeys.upsertMany([
      { worktreeId: r.worktreeId, testFile: SLOW_FILE, key: "s2", revision: 2, pending: "queued" },
      {
        worktreeId: r.worktreeId,
        testFile: { project: "", path: "src/math.test.ts" },
        key: "k2",
        revision: 2,
        pending: "running",
      },
    ]);
    r.sink.refresh(r.worktreeId, 2, { checkpointId: null });

    expect(await runHook("stop", recorded("stop", r.root), deps())).toEqual(SILENT);
  });
});

describe("SubagentStop (review wave 3, S6)", () => {
  it("delivers, then unregisters the subagent's consumer", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook("session-start", recorded("subagent-start", r.root), deps());
    r.apply(r.fail());

    const out = await runHook("stop", recorded("subagent-stop", r.root), deps());

    expect(out.stdout).toContain("PASS -> FAIL");
    expect(r.store.consumers.get(r.consumer(SUBAGENT))).toBeNull();
    expect(r.store.views.list(r.consumer(SUBAGENT))).toEqual([]);
  });

  it("unregisters a subagent that had nothing to hear", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook("session-start", recorded("subagent-start", r.root), deps());

    expect(await runHook("stop", recorded("subagent-stop", r.root), deps())).toEqual(SILENT);
    expect(r.store.consumers.get(r.consumer(SUBAGENT))).toBeNull();
  });

  it("keeps a subagent that a block keeps going, and the main agent's consumer always", async () => {
    const r = squealRepo();
    r.apply(r.fail());
    await runHook("session-start", recorded("session-start", r.root), deps());
    await runHook("session-start", recorded("subagent-start", r.root), deps());
    r.policy({ stop: { blockOnKnownFailures: true } });

    const blocked = await runHook("stop", recorded("subagent-stop", r.root), deps());
    expect(json(blocked)).toMatchObject({ decision: "block" });
    expect(r.store.consumers.get(r.consumer(SUBAGENT))).not.toBeNull();

    await runHook("stop", recorded("stop", r.root, { stop_hook_active: true }), deps());
    expect(r.store.consumers.get(r.consumer())).not.toBeNull();
  });
});

describe("Stop's wait for pending checks (review wave 4.5, S1)", () => {
  it("waits while the runner part of the current revision is pending", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook("session-start", recorded("session-start", r.root), deps());
    r.apply(r.pass());
    const revision = r.store.revisions.latest(r.worktreeId)?.number ?? 0;
    // Every check is current, but the runner has not looked at this revision yet.
    r.store.meta.set(refinedMetaKey(r.worktreeId), String(revision - 1));
    r.policy({ stop: { waitMs: 1_000 } });
    const refined = setTimeout(
      () => r.store.meta.set(refinedMetaKey(r.worktreeId), String(revision)),
      300,
    );
    try {
      const started = performance.now();
      await runHook("stop", recorded("stop", r.root), deps());
      const elapsed = performance.now() - started;

      expect(elapsed).toBeGreaterThanOrEqual(290);
      expect(elapsed).toBeLessThan(900);
    } finally {
      clearTimeout(refined);
    }
  });
});

describe("Stop within its 2 s hook timeout (review wave 3, N4)", () => {
  it("leaves room for the busy timeout after the longest wait", () => {
    expect(STOP_WAIT_CAP_MS + stopBusyTimeoutMs(STOP_WAIT_CAP_MS) + STOP_MARGIN_MS).toBe(
      HOOK_TIMEOUT_MS,
    );
    expect(stopBusyTimeoutMs(0)).toBe(1_000);
  });

  it("gives up on a locked store before Claude Code would kill it", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook("session-start", recorded("session-start", r.root), deps());
    r.apply(r.fail());
    queue(r, { project: "", path: "src/math.test.ts" }, "k9");
    r.policy({ stop: { waitMs: 5_000 } });
    const holder = new DatabaseSync(storePaths(r.repo.commonDir).database);
    // The daemon takes a write lock while Stop waits for the pending check.
    const lock = setTimeout(() => holder.exec("BEGIN IMMEDIATE"), 200);
    try {
      const started = performance.now();
      const out = await runHook("stop", recorded("stop", r.root), deps());
      const elapsed = performance.now() - started;

      expect(out).toEqual(SILENT);
      expect(elapsed).toBeGreaterThanOrEqual(STOP_WAIT_CAP_MS);
      // In process, so no Node start: the margin is left over.
      expect(elapsed).toBeLessThan(HOOK_TIMEOUT_MS - STOP_MARGIN_MS / 2);
    } finally {
      clearTimeout(lock);
      if (holder.isTransaction) holder.exec("ROLLBACK");
      holder.close();
    }
  });
});
