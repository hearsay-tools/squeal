import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { leaseProcess } from "../../src/core/daemon/lease-process.js";
import { LEASE_TTL_MS } from "../../src/core/daemon/write-desk.js";
import { testCommandDenied } from "../../src/core/delivery/test-command-denied.js";
import { omittedTestFilesMetaKey } from "../../src/core/scheduler/omitted-test-files.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import { HandOff, writeThenCommit } from "../../src/harness/shared/hand-off.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { countWrites, type ServedWrites, serveWrites } from "./daemon-writes-helpers.js";
import { recorded, type SquealRepo, SUBAGENT, squealRepo } from "./helpers.js";

/*
 * Spec 021 D15 (row 021-16): while a daemon serves the worktree, the hooks
 * send their store writes to its socket and it writes them; they write the
 * store themselves only when none serves. A report is still marked told
 * only once its host has the text, and parallel hooks tell it once: the
 * worktree's write lease stands in for SQLite's write lock.
 */

const TRANSITION = "PASS -> FAIL";
const served: ServedWrites[] = [];
afterEach(async () => {
  for (const s of served.splice(0)) await s.close();
});

const deps = (overrides: Partial<HookDeps> = {}): HookDeps => ({
  env: {},
  ensureDaemon: async () => "alive",
  harnessProcess: () => null,
  ...overrides,
});

const hook = (r: SquealRepo, name: string, overrides: object = {}, extra: Partial<HookDeps> = {}) =>
  runHook(name as never, recorded(name, r.root, overrides), deps(extra));

/** A repository with one passing check and no code features, its daemon serving in this process. */
async function serving(): Promise<{ r: SquealRepo; daemon: ServedWrites }> {
  const r = squealRepo();
  r.policy({});
  r.apply(r.pass());
  const daemon = await serveWrites(r);
  served.push(daemon);
  return { r, daemon };
}

describe("hooks while a daemon serves (021-16)", () => {
  it("make no store write of their own: the daemon writes every one", async () => {
    const { r, daemon } = await serving();
    // Counted around the hooks only: the fixture's results stand for the daemon's scheduler.
    const hooks = async (...names: string[]) => {
      const count = countWrites(daemon.store);
      const outs = [];
      for (const name of names) outs.push(await hook(r, name));
      return { outs, counted: count.stop() };
    };
    const before = await hooks("session-start", "user-prompt-submit");
    r.apply(r.fail());
    const after = await hooks("post-tool-batch", "post-tool-batch", "stop");
    const [told, again] = after.outs;
    expect(told?.stdout).toContain(TRANSITION);
    expect(again?.stdout).not.toContain(TRANSITION);
    for (const { counted } of [before, after]) {
      expect(counted.transactions).toBe(0);
      expect(counted.madeWritable).toBe(0);
    }
    expect(before.counted.statements + after.counted.statements).toBe(daemon.statements());
    expect(daemon.batches.length).toBeGreaterThan(0);
    expect(r.store.consumers.get(r.consumer())).not.toBeNull();
  });

  it("write the store themselves when no daemon serves", async () => {
    const r = squealRepo();
    r.policy({});
    r.apply(r.pass());
    r.store.worktrees.setDaemon(r.worktreeId, null);
    await hook(r, "session-start");
    r.apply(r.fail());
    // The test's own connection stands where a daemon's would: the hook's writes are counted.
    const count = countWrites(r.store);
    const told = await hook(r, "post-tool-batch");
    const counted = count.stop();
    expect(told.stdout).toContain(TRANSITION);
    expect(counted.transactions).toBeGreaterThan(0);
  });

  it("mark a report told only once the host has its text; a failed hand-off leaves it owed", async () => {
    const { r, daemon } = await serving();
    await hook(r, "session-start");
    r.apply(r.fail());
    const lost = new HandOff();
    const first = await hook(r, "post-tool-batch", {}, { handOff: lost });
    expect(first.stdout).toContain(TRANSITION);
    const before = daemon.batches.length;
    expect(lost.pending).toBe(true);
    // Nothing of the report reached the daemon while the host has not the text.
    expect(daemon.batches.length).toBe(before);
    await writeThenCommit(lost, [[failing, first.stdout]]);
    expect(daemon.batches.length).toBe(before);
    const kept = new HandOff();
    const second = await hook(r, "post-tool-batch", {}, { handOff: kept });
    expect(second.stdout).toContain(TRANSITION);
    await writeThenCommit(kept, [[working, second.stdout]]);
    expect(daemon.batches.length).toBeGreaterThan(before);
    expect((await hook(r, "post-tool-batch")).stdout).not.toContain(TRANSITION);
  });

  it("tell a transition once over parallel boundaries of one session", async () => {
    const { r } = await serving();
    await hook(r, "session-start");
    r.apply(r.fail());
    const outs = await Promise.all([1, 2, 3].map(() => hook(r, "post-tool-batch")));
    expect(outs.filter((o) => o.stdout.includes(TRANSITION))).toHaveLength(1);
  });

  it("hold the lease through a hand-off: a parallel boundary waits, then finds nothing new", async () => {
    const { r } = await serving();
    await hook(r, "session-start");
    r.apply(r.fail());
    const held = new HandOff();
    const first = await hook(r, "post-tool-batch", {}, { handOff: held });
    expect(first.stdout).toContain(TRANSITION);
    const parallel = hook(r, "post-tool-batch");
    await new Promise((done) => setTimeout(done, 50));
    await writeThenCommit(held, [[working, first.stdout]]);
    expect((await parallel).stdout).not.toContain(TRANSITION);
  });

  it(
    "keep a report their own while a hook paused past the lease's time hands it off (review 0.1.442 B3)",
    async () => {
      const { r } = await serving();
      await hook(r, "session-start");
      r.apply(r.fail());
      const paused = new HandOff();
      const first = await hook(r, "post-tool-batch", {}, { handOff: paused });
      expect(first.stdout).toContain(TRANSITION);
      // Its output not yet written, past the lease's time: its process lives, so it keeps the lease.
      await new Promise((done) => setTimeout(done, LEASE_TTL_MS + 200));
      const overlapping = await hook(r, "post-tool-batch");
      await writeThenCommit(paused, [[working, first.stdout]]);
      const after = await hook(r, "post-tool-batch");
      const told = [first, overlapping, after].filter((o) => o.stdout.includes(TRANSITION));
      expect(told).toEqual([first]);
    },
    LEASE_TTL_MS * 4,
  );

  it(
    "take the lease again once its client died, after the lease's time, and tell what that client did not",
    async () => {
      const { r } = await serving();
      await hook(r, "session-start");
      r.apply(r.fail());
      const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"]);
      await new Promise((done) => child.once("spawn", done));
      const socketPath = r.store.worktrees.get(r.worktreeId)?.daemon?.socketPath;
      if (socketPath === undefined) throw new Error("no daemon recorded");
      const taken = await requestDaemon(
        socketPath,
        {
          type: "lease",
          worktreeId: r.worktreeId,
          holder: "dying",
          process: leaseProcess(child.pid),
        },
        1_000,
      );
      expect(taken).toMatchObject({ ok: true, token: expect.any(String) });
      child.kill("SIGKILL");
      await new Promise((done) => child.once("exit", done));
      expect((await hook(r, "post-tool-batch")).stdout).not.toContain(TRANSITION);
      await new Promise((done) => setTimeout(done, LEASE_TTL_MS + 200));
      expect((await hook(r, "post-tool-batch")).stdout).toContain(TRANSITION);
    },
    LEASE_TTL_MS * 4,
  );

  it("deny an answered test command once over parallel calls (005 D8)", async () => {
    const r = squealRepo();
    r.store.meta.set(omittedTestFilesMetaKey(r.worktreeId), "0");
    r.policy({ testCommand: { denyWhenCurrent: true } });
    r.apply(r.pass());
    const daemon = await serveWrites(r);
    served.push(daemon);
    await hook(r, "session-start");
    const call = { tool_name: "Bash", tool_input: { command: "npx vitest run math" } };
    const outs = await Promise.all([1, 2, 3].map(() => hook(r, "pre-tool-use", call)));
    expect(outs.filter((o) => o.stdout.includes('"deny"'))).toHaveLength(1);
    expect(testCommandDenied(r.store, r.consumer())).toBe(true);
  });

  it("keep a subagent's registration and its end on the daemon's path too", async () => {
    const { r, daemon } = await serving();
    await hook(r, "session-start");
    const count = countWrites(daemon.store);
    await runHook("session-start", recorded("subagent-start", r.root), deps());
    expect(r.store.consumers.get(r.consumer(SUBAGENT))).not.toBeNull();
    await runHook("stop", recorded("subagent-stop", r.root), deps());
    const counted = count.stop();
    expect(counted.transactions).toBe(0);
    expect(r.store.consumers.get(r.consumer(SUBAGENT))).toBeNull();
  });
});

const failing = {
  write: (_text: string, callback: (error?: Error | null) => void) => {
    callback(new Error("EPIPE"));
    return false;
  },
};

const working = {
  write: (_text: string, callback: (error?: Error | null) => void) => {
    callback(null);
    return true;
  },
};
