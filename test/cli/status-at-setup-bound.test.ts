import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { type AtDaemons, realDaemons } from "../../src/cli/status-at-daemons.js";
import { RECORD_WAIT_MS } from "../../src/cli/status-at-queue.js";
import { installCommitWorktree } from "../../src/core/checkout/commit-setup.js";
import { ensureCommitWorktree } from "../../src/core/checkout/commit-worktree.js";
import { COMMIT_WORKTREES } from "../../src/core/daemon/commit-mode.js";
import { type RunningDaemon, startDaemon } from "../../src/core/daemon/daemon.js";
import { awaitDaemonLock } from "../../src/core/daemon/lock.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { childEnv, SLOW } from "../daemon/helpers.js";
import { run, standIn, standInTree, testOf } from "./status-at-kit.js";
import { keyedNow } from "./status-at-now-stand-in.js";

/*
 * Review wave-23 re-review B1, the required regressions (spec 023 D7.3 as
 * amended 2026-11-21, row 023-40c, "A: daemon owns setup"): the call
 * returns by its bound plus a small allowance while the commit worktree's
 * install blocks (in its real commit daemon, which then finishes it; a
 * later `--wait` reads the result), while another installer holds the
 * install lock, and while the working tree's daemon is slow to answer its
 * start (the real `squeal start` path, its spawn wait cut to the time
 * left). The commit daemons run in this process; their install is the
 * fixture's link, held by a barrier the test opens.
 */

const A = ref("test/a.test.ts");
const RUN = { allMissing: false };
/** What a call may take past its bound: the report, a socket's last read, a busy host. */
const ALLOWANCE_MS = 6_000;

/** Commit A, then HEAD changes what the test reads. */
function changed(): { f: Fixture; a: string } {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 1;\n",
    [A.path]: testOf("a", 1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n" });
  return { f, a };
}

/** A gate the test opens. */
function barrier() {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

/** The real commit daemon, in this process, its install held until `held` opens. */
function commitDaemons(
  root: string,
  held: Promise<void>,
): { daemons: AtDaemons; started: string[] } {
  const runtime = realpathSync(mkdtempSync("/tmp/sq-at-"));
  const running: RunningDaemon[] = [];
  const started: string[] = [];
  onTestFinished(async () => {
    for (const daemon of running) await daemon.stop("stop-requested");
    rmSync(runtime, { recursive: true, force: true });
  });
  const install = async (tree: AbsolutePath) => {
    started.push("install");
    await held;
    return installCommitWorktree(tree, { install: linkInstall().install });
  };
  const real = realDaemons({
    start: async (tree) => {
      const daemon = await startDaemon({
        root: tree,
        env: childEnv(runtime),
        commitWorktrees: { ...COMMIT_WORKTREES, install },
      });
      if ("reason" in daemon) return daemon.message;
      running.push(daemon);
      let exited = false;
      void daemon.exited.then(() => {
        exited = true;
      });
      return { lives: async () => !exited };
    },
  });
  const daemons: AtDaemons = {
    ...real,
    worktree: async () => null,
    now: keyedNow,
    ask: async (at, group, paths, deadline, call) =>
      at === root ? "taken" : real.ask(at, group, paths, deadline, call),
    wait: async (at, files, deadline) => (at === root ? null : real.wait(at, files, deadline)),
  };
  return { daemons, started };
}

const timed = async <T>(work: () => Promise<T>) => {
  const began = Date.now();
  const value = await work();
  return { value, ms: Date.now() - began };
};

type Side = { state: string; pending?: string; origin?: { kind: string } };
const atOf = (out: string) =>
  (JSON.parse(out).files as { path: string; at: Side }[]).find((x) => x.path === A.path)?.at;

describe("status --at --run returns by its bound while setup runs (row 023-40c)", SLOW, () => {
  it("while the commit install blocks; the daemon finishes it and a later --wait reads the result", {
    timeout: 120_000,
  }, async () => {
    const { f, a } = changed();
    const gate = barrier();
    const { daemons, started } = commitDaemons(f.root, gate.opened);
    const options = { cacheRoot: f.cacheRoot, daemons };
    const waitMs = 4000;

    const { value: called, ms } = await timed(() =>
      run(f, { commit: a, paths: [A.path], run: RUN, waitMs, json: true }, options),
    );
    expect(started).toEqual(["install"]);
    expect(ms).toBeLessThan(Math.max(waitMs, RECORD_WAIT_MS) + ALLOWANCE_MS);
    expect(called.code).toBe(3);
    expect(atOf(called.out)).toMatchObject({ state: "no result", pending: "setting up" });
    expect(JSON.parse(called.out).run.commit).toMatchObject({ setup: "install" });
    const text = await run(f, { commit: a, paths: [A.path], waitMs: 0 }, options);
    expect(text.out).toContain(
      `still setting up at ${a.slice(0, 9)} (install), 0 in the working tree; their runs go on in the daemons. squeal status --at ${a} ${A.path} --wait 100000 waits for them`,
    );

    // The install ends in the daemon; Q7's call joins the kept ask and reads the commit's pass.
    gate.open();
    const joined = await run(
      f,
      { commit: a, paths: [A.path], waitMs: 100_000, json: true },
      options,
    );
    expect(atOf(joined.out), joined.err).toMatchObject({
      state: "pass",
      origin: { kind: "commit" },
    });
  });

  it("while another installer holds the install lock with a longer wait", {
    timeout: 120_000,
  }, async () => {
    const { f, a } = changed();
    // Another caller made the worktree and installs it: it holds the folder's install lock.
    const made = await ensureCommitWorktree({
      root: f.root,
      commit: a,
      cacheRoot: f.cacheRoot,
      installs: false,
    });
    const lock = await awaitDaemonLock(join(made.folder, "install.lock"), {
      timeoutMs: 5_000,
      giveUp: () => false,
    });
    if (typeof lock === "string") throw new Error(lock);
    onTestFinished(() => lock.release());
    const gate = barrier();
    gate.open();
    const { daemons } = commitDaemons(f.root, gate.opened);
    const options = { cacheRoot: f.cacheRoot, daemons };

    const { value: called, ms } = await timed(() =>
      run(f, { commit: a, paths: [A.path], run: RUN, waitMs: 3000, json: true }, options),
    );
    expect(ms).toBeLessThan(RECORD_WAIT_MS + ALLOWANCE_MS);
    expect(JSON.parse(called.out).run.commit).toMatchObject({ tree: made.tree, setup: "install" });

    lock.release();
    const joined = await run(
      f,
      { commit: a, paths: [A.path], waitMs: 100_000, json: true },
      options,
    );
    expect(atOf(joined.out), joined.err).toMatchObject({ state: "pass" });
  });

  it("while the working tree's daemon does not answer its start", {
    timeout: 120_000,
  }, async () => {
    const { f, a } = changed();
    // A daemon that never answers: `squeal start` spawns it and waits for it (30 s alone).
    const dir = realpathSync(mkdtempSync("/tmp/sq-late-"));
    const stop = join(dir, "stop");
    const cli = join(dir, "late.mjs");
    writeFileSync(
      cli,
      `import { existsSync } from "node:fs";\nsetInterval(() => { if (existsSync(${JSON.stringify(stop)})) process.exit(0); }, 100);\n`,
    );
    vi.stubEnv("SQUEAL_CLI", cli);
    onTestFinished(() => {
      writeFileSync(stop, "");
      vi.unstubAllEnvs();
    });
    const tree = standInTree(f);
    const ports = standIn(tree, () => undefined).ports;
    // The working tree's side is the real one: no daemon answers, so it is started.
    const real = realDaemons();
    const daemons: AtDaemons = { ...ports, worktree: real.worktree };
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install, daemons };

    const { value: called, ms } = await timed(() =>
      run(f, { commit: a, paths: [A.path], run: RUN, waitMs: 3000, json: true }, options),
    );
    expect(ms).toBeLessThan(RECORD_WAIT_MS + ALLOWANCE_MS);
    expect(JSON.parse(called.out).run.now.problem).toContain("is still starting");
  });
});
