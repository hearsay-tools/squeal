import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runWait } from "../../../src/cli/wait/wait.js";
import { isLintStoreOpenFailure, openLintStore } from "../../../src/core/lint/store/open.js";
import type { RevisionNumber } from "../../../src/core/types/common.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";
import {
  awaitingInstallMetaKey,
  installCommandMetaKey,
} from "../../../src/core/types/scheduler.js";
import { squealRepo } from "../../harness/helpers.js";
import { appendRevisions, fakeRepo } from "../../status/helpers.js";
import { closeFakeDaemons, fakeDaemon, lockStore, received } from "../fake-daemon.js";
import {
  closeLoopFixtures,
  ref,
  scratch,
  socketPath,
  stalling,
  steppedClock,
  timingOut,
} from "./fixture.js";

/*
 * Row 011-326: the run waits' loop rows, over a scratch store, the fake
 * daemon socket and a stepped clock. Each read is a second of the clock
 * apart, the last one at the deadline; the fifth read asks the daemon.
 */

afterEach(() => {
  closeFakeDaemons();
  closeLoopFixtures();
});

const A = "test/a.test.ts";

/** A checkpoint `c1` at revision 3 over the scratch worktree's files. */
function checkpointWait(deadlineIn: number, files: readonly string[] = [A]) {
  const w = scratch();
  w.store.checkpoints.start({
    id: "c1",
    worktreeId: w.id,
    revision: 3 as RevisionNumber,
    kind: "run-all",
    testFiles: files.map(ref),
    startedAt: 1,
  });
  const clock = steppedClock();
  const socket = socketPath();
  const ask = {
    wait: "checkpoint",
    root: w.root,
    socketPath: socket,
    deadline: clock.start + deadlineIn,
    checkpoint: { id: "c1", worktreeId: w.id, revision: 3 },
    files: { kind: "lane", lane: null },
  } as const;
  return { w, clock, socket, ask };
}

describe("the checkpoint wait's loop (row 011-326)", () => {
  it("reads once a second, the last read at the deadline: deadline", async () => {
    const { w, clock, socket, ask } = checkpointWait(2_500);
    w.file(A, { validity: "pending", pending: "running" });
    await fakeDaemon(socket, {});
    const outcome = await runWait(ask, clock.ports);
    expect(outcome).toMatchObject({ kind: "deadline", verdict: { byClass: { pending: 1 } } });
    expect(clock.pauses).toEqual([1_000, 1_000, 500]);
    expect(clock.at()).toBe(ask.deadline);
    expect(received).toEqual([]);
  });

  it("reads the store again after each pause: ended once the checkpoint completed", async () => {
    const { w, clock, ask } = checkpointWait(60_000);
    w.file(A, { validity: "pending", pending: "running" });
    clock.onPause((n) => {
      if (n !== 2) return;
      w.file(A);
      w.store.checkpoints.finish("c1", "completed", 2);
    });
    const outcome = await runWait(ask, clock.ports);
    expect(outcome).toMatchObject({ kind: "ended", verdict: { testFiles: 1 } });
    expect(clock.pauses).toEqual([1_000, 1_000]);
  });

  it("asks the daemon on the fifth read, and goes on while it answers", async () => {
    const { w, clock, socket, ask } = checkpointWait(6_000);
    w.file(A, { validity: "pending", pending: "running" });
    await fakeDaemon(socket, {});
    expect(await runWait(ask, clock.ports)).toMatchObject({ kind: "deadline" });
    expect(clock.pauses).toEqual([1_000, 1_000, 1_000, 1_000, 1_000, 1_000]);
    expect(received).toEqual([{ type: "ping" }]);
  });

  it("stopped: the fifth read's ping finds no daemon", async () => {
    const { w, clock, ask } = checkpointWait(60_000);
    w.file(A, { validity: "pending", pending: "running" });
    expect(await runWait(ask, clock.ports)).toEqual({ kind: "stopped" });
    expect(clock.pauses).toEqual([1_000, 1_000, 1_000, 1_000]);
  });

  it("a ping with no answer is a busy daemon: it goes on, no throw (011-327, review 0.1.469 N2)", async () => {
    const { w, clock, ask } = checkpointWait(6_000);
    w.file(A, { validity: "pending", pending: "running" });
    const ports = timingOut(clock.ports, ["ping"]);
    expect(await runWait(ask, ports)).toMatchObject({ kind: "deadline" });
    expect(clock.pauses).toEqual([1_000, 1_000, 1_000, 1_000, 1_000, 1_000]);
  });

  it("moved: a revision recorded during the wait", async () => {
    const { w, clock, ask } = checkpointWait(60_000);
    w.file(A, { validity: "pending", pending: "running" });
    clock.onPause(() => appendRevisions(w.store, w.id, 1, { head: null, dirty: true }));
    expect(await runWait(ask, clock.ports)).toEqual({ kind: "moved", revision: 4 });
  });

  it("stopped: a store that does not open (accidental, 011-327 gives its reason)", async () => {
    const { clock, socket } = checkpointWait(60_000);
    const repo = fakeRepo();
    const ask = {
      wait: "checkpoint",
      root: repo.main,
      socketPath: socket,
      deadline: clock.start + 60_000,
      checkpoint: { id: "c1", worktreeId: repo.mainId, revision: 3 },
      files: { kind: "lane", lane: null },
    } as const;
    expect(await runWait(ask, clock.ports)).toEqual({ kind: "stopped" });
    expect(clock.pauses).toEqual([]);
  });

  it("a busy store throws out of the wait (accidental, 011-327 reads again)", async () => {
    const { w, clock, ask } = checkpointWait(60_000);
    w.store.close();
    lockStore(w.commonDir);
    await expect(runWait(ask, clock.ports)).rejects.toThrow(/locked/);
  });
});

const GROUPS = {
  checks: [{ name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" }],
};
const E2E = "test/e2e/a.test.ts";
const E2E_B = "test/e2e/b.test.ts";

function groupWait(deadlineIn: number, files: "group" | readonly string[] = "group") {
  const w = scratch(GROUPS);
  const clock = steppedClock();
  const socket = socketPath();
  const ask = {
    wait: "group",
    root: w.root,
    socketPath: socket,
    deadline: clock.start + deadlineIn,
    files:
      files === "group"
        ? ({ kind: "group", group: "e2e" } as const)
        : ({ kind: "list", files: files.map(ref) } as const),
  } as const;
  return { w, clock, socket, ask };
}

describe("the group wait's loop (row 011-326)", () => {
  it("deadline at the last read names the install the worktree waits for", async () => {
    const { w, clock, ask } = groupWait(1_000);
    w.file(E2E, { validity: "pending", pending: "queued" });
    w.store.meta.set(awaitingInstallMetaKey(w.id), "true");
    w.store.meta.set(installCommandMetaKey(w.id), "pnpm install");
    expect(await runWait(ask, clock.ports)).toMatchObject({
      kind: "deadline",
      verdict: { byClass: { pending: 1 } },
      install: { command: "pnpm install" },
    });
    expect(clock.pauses).toEqual([1_000]);
  });

  it("a list waits for its own files only", async () => {
    const { w, clock, ask } = groupWait(60_000, [E2E_B]);
    w.file(E2E, { validity: "pending", pending: "queued" });
    w.file(E2E_B);
    expect(await runWait(ask, clock.ports)).toMatchObject({
      kind: "ended",
      verdict: { testFiles: 1 },
    });
    expect(clock.pauses).toEqual([]);
  });

  it("a ping with no answer within the deadline is a busy daemon: it goes on (019-24)", async () => {
    const { w, clock, socket, ask } = groupWait(4_050);
    w.file(E2E, { validity: "pending", pending: "queued" });
    let pings = 0;
    await stalling(socket, () => {
      pings += 1;
      return null;
    });
    expect(await runWait(ask, clock.ports)).toMatchObject({ kind: "deadline" });
    expect(clock.pauses).toEqual([1_000, 1_000, 1_000, 1_000, 50]);
    expect(pings).toBe(1);
  });

  it("stopped: the fifth read's ping finds no daemon", async () => {
    const { w, clock, ask } = groupWait(60_000);
    w.file(E2E, { validity: "pending", pending: "queued" });
    expect(await runWait(ask, clock.ports)).toEqual({ kind: "stopped" });
  });
});

/** A lint group `lint` of eslint at `commit` with `states`; lint off without them. */
function lintWait(deadlineIn: number, states: Record<string, "pass" | "pending"> | "off") {
  const r = squealRepo();
  if (states !== "off") {
    writeFileSync(
      join(r.root, "squeal.config.json"),
      JSON.stringify({
        lint: { enabled: true, tools: ["eslint"] },
        checks: [{ name: "lint", lint: true, at: "commit" }],
      }),
    );
    const lint = { ...DEFAULT_POLICY.lint, enabled: true };
    const store = openLintStore(r.repo.commonDir, { lint }, { busyTimeoutMs: 5_000 });
    if (isLintStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
    for (const [path, outcome] of Object.entries(states)) {
      store.states.upsertMany([
        {
          worktreeId: r.worktreeId,
          check: { kind: "lint", path, tool: "eslint" },
          outcome,
          judged: null,
          stale: false,
          reason: null,
          changedAt: 1,
        },
      ]);
    }
    store.close();
  }
  const clock = steppedClock();
  const ask = {
    wait: "lint group",
    root: r.root,
    socketPath: socketPath(),
    deadline: clock.start + deadlineIn,
    files: { kind: "group", group: "lint" },
  } as const;
  return { clock, ask };
}

describe("the lint group wait's loop (row 011-326)", () => {
  it("ended: nothing left to lint before the deadline", async () => {
    const { clock, ask } = lintWait(60_000, { "src/a.js": "pass" });
    expect(await runWait(ask, clock.ports)).toMatchObject({
      kind: "ended",
      counts: { files: 1, linting: 0 },
    });
  });

  it("deadline at the deadline's read, though nothing is left to lint (accidental, 011-327)", async () => {
    const { clock, ask } = lintWait(0, { "src/a.js": "pass" });
    expect(await runWait(ask, clock.ports)).toMatchObject({
      kind: "deadline",
      counts: { files: 1, linting: 0 },
    });
  });

  it("off: lint is off", async () => {
    const { clock, ask } = lintWait(60_000, "off");
    expect(await runWait(ask, clock.ports)).toEqual({ kind: "off" });
  });
});
