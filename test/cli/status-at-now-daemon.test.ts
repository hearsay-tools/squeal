import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { commitAllowlist, environmentOf, REPORT_RESERVE_MS } from "../../src/cli/status-at-call.js";
import { type AtDaemons, realDaemons } from "../../src/cli/status-at-daemons.js";
import { RUN_WAIT_MS } from "../../src/cli/status-at-report-queued.js";
import { installCommitWorktree } from "../../src/core/checkout/commit-setup.js";
import { COMMIT_WORKTREES } from "../../src/core/daemon/commit-mode.js";
import { type RunningDaemon, startDaemon } from "../../src/core/daemon/daemon.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { childEnv, SLOW, waitFor } from "../daemon/helpers.js";
import { run, testOf } from "./status-at-kit.js";

/*
 * Review wave-23-third B1, the required regression (spec 023 D7.3 as
 * amended 2026-11-22, the human: "Ask the daemon"): the reviewer's
 * fixture, a Vitest `configResolved` hook that does not end while the call
 * runs (here held by a barrier file, standing for 125 s), in a worktree
 * with no daemon. The default `--run` call starts the worktree's real
 * daemon and asks it; the daemon's start blocks in the hook, and the call
 * returns by its 100 s wait plus a small allowance, reading the working
 * tree as still setting up. It never loads the configuration itself: the
 * old call keyed the working tree in the caller and hung in the hook. The
 * commit side is a real commit daemon, held in the same hook. Once the hook
 * ends, Q7's next `--run` reads both sides in the same call, a first run
 * that observed a tracked file at its completed key included (wave 23 B3,
 * on both sides). Both daemons run in this process and stop at the end.
 * Row 010-37: the call's default wait is `DEFAULT_WAIT_MS` here
 * (`AtOptions.defaultWaitMs`), still with no `waitMs`, so the omitted-wait
 * path and its bound run in seconds; the production default stays 100 s.
 * The asks keep their floor of `RECORD_WAIT_MS` past the start, so a call
 * whose daemons never answer returns by the later of the two.
 * Row 011-429: the commit daemon is started, and seen held in the hook,
 * before the call, which finds it serving; the call's few seconds raced its
 * install on a loaded runner, and read the setup as "install". The call
 * still starts the worktree's daemon, which is seen entering the hook after.
 */

const A = ref("test/a.test.ts");
const P = ref("test/p.test.ts");
const RUN = { allMissing: false };
/** The default wait of these calls, in place of `RUN_WAIT_MS` (row 010-37). */
const DEFAULT_WAIT_MS = 3_000;
/** How long a daemon may take to reach the hook: a ceiling on a hang, not a measure. */
const ENTER_MS = 120_000;

/** A test that reads tracked `payload.json` at run time, which no static walk sees. */
const reads = [
  'import { readFileSync } from "node:fs";',
  'import { expect, it } from "vitest";',
  'const payload = () => JSON.parse(readFileSync(new URL("../payload.json", import.meta.url), "utf8"));',
  'it("payload", () => expect(payload().ok).toBe(true));',
  "",
].join("\n");

/**
 * The reviewer's plugin: its `configResolved` waits until `release` exists;
 * `entered` gets a line with each project root that began it.
 */
const slowConfig = (entered: string, release: string) =>
  [
    'import { appendFileSync, existsSync } from "node:fs";',
    "export default {",
    "  plugins: [{",
    '    name: "slow-project-start",',
    "    async configResolved(config) {",
    `      appendFileSync(${JSON.stringify(entered)}, \`\${config.root}\\n\`);`,
    `      while (!existsSync(${JSON.stringify(release)})) await new Promise((r) => setTimeout(r, 50));`,
    "    },",
    "  }],",
    '  test: { include: ["test/*.test.ts"] },',
    "};",
    "",
  ].join("\n");

/** Whether the daemon of `root` is held in the hook: `entered` names it. */
function inHook(entered: string, root: string): boolean {
  if (!existsSync(entered)) return false;
  const roots = readFileSync(entered, "utf8")
    .split("\n")
    .filter((line) => line !== "");
  const own = realpathSync(root);
  return roots.some((line) => existsSync(line) && realpathSync(line) === own);
}

/** Both real daemons, in this process: the commit daemon with the fixture's install, and the worktree's. */
function bothDaemons(release: string): {
  daemons: AtDaemons;
  commitStarts: string[];
  worktreeStarts: string[];
} {
  const runtime = realpathSync(mkdtempSync("/tmp/sq-at-"));
  const running: RunningDaemon[] = [];
  const commitStarts: string[] = [];
  const worktreeStarts: string[] = [];
  onTestFinished(async () => {
    // A daemon held in the hook stops once the hook ends.
    writeFileSync(release, "done");
    for (const daemon of running) await daemon.stop("stop-requested");
    rmSync(runtime, { recursive: true, force: true });
  }, 60_000);
  const install = (tree: AbsolutePath) =>
    installCommitWorktree(tree, { install: linkInstall().install });
  const daemons = realDaemons({
    start: async (tree) => {
      commitStarts.push(tree);
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
    // The working tree's daemon, as `squeal start` would start it, here in this process.
    startWorktree: async (root) => {
      worktreeStarts.push(root);
      const daemon = await startDaemon({ root, env: childEnv(runtime) });
      if ("reason" in daemon) return daemon.message;
      running.push(daemon);
      return null;
    },
  });
  return { daemons, commitStarts, worktreeStarts };
}

type Side = { state: string; pending?: string; origin?: { kind: string } };
type Row = { path: string; at: Side; now: Side };
const rowOf = (out: string, path: string) =>
  (JSON.parse(out).files as Row[]).find((row) => row.path === path);

describe("status --at --run asks the working tree's daemon (review wave-23-third B1)", SLOW, () => {
  it("waits 100 s by default", () => {
    expect(RUN_WAIT_MS).toBe(100_000);
  });

  it("returns by the default wait while the worktree's config hook blocks, then reads both sides once it ends", {
    timeout: 400_000,
  }, async () => {
    const holder = realpathSync(mkdtempSync("/tmp/sq-hook-"));
    onTestFinished(() => rmSync(holder, { recursive: true, force: true }));
    const entered = join(holder, "entered");
    const release = join(holder, "release");
    onTestFinished(() => writeFileSync(release, "done"));
    const f = fixture({
      "vitest.config.mjs": slowConfig(entered, release),
      "src/a.ts": "export const value = 1;\n",
      [A.path]: testOf("a", 1),
      "payload.json": '{ "ok": true }\n',
      [P.path]: reads,
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({
      "src/a.ts": "export const value = 2;\n",
      [A.path]: testOf("a", 2),
      "payload.json": '{ "ok": true, "v": 2 }\n',
    });
    const { daemons, commitStarts, worktreeStarts } = bothDaemons(release);
    const options = { cacheRoot: f.cacheRoot, daemons };
    const paths = [A.path, P.path];

    // The commit daemon the call will ask, held in the hook: its setup is "starting" until the release.
    const environment = environmentOf(await commitAllowlist(f.root, a), process.env);
    const tree = await daemons.commit({
      root: f.root,
      commit: a,
      environment,
      cacheRoot: f.cacheRoot,
      note: () => {},
    });
    if (typeof tree !== "string") throw new Error(tree.problem);
    await waitFor(() => inHook(entered, tree), ENTER_MS, "the commit daemon in the hook");

    // The default wait (`DEFAULT_WAIT_MS` here): no `waitMs`.
    const began = Date.now();
    const first = await run(
      f,
      { commit: a, paths, run: RUN, json: true },
      { ...options, defaultWaitMs: DEFAULT_WAIT_MS },
    );
    const ms = Date.now() - began;
    // Returned by its own wait: the production default's could not have ended yet.
    expect(ms, first.err).toBeLessThan(RUN_WAIT_MS - REPORT_RESERVE_MS);
    expect(commitStarts, "the call asked the commit daemon it found").toEqual([tree]);
    expect(worktreeStarts).toEqual([f.root]);
    await waitFor(() => inHook(entered, f.root), ENTER_MS, "the worktree's daemon in the hook");
    const report = JSON.parse(first.out);
    expect(report.now).toEqual({ kind: "setting up" });
    // Neither daemon answered: the call knows no file to queue in the working tree, and says why.
    expect(report.run).toMatchObject({ waitMs: DEFAULT_WAIT_MS, now: { setup: true, files: 0 } });
    expect(report.run.commit.setup).toBe("starting");
    expect(rowOf(first.out, A.path)?.now).toEqual({
      state: "no result",
      key: "",
      pending: "setting up",
    });
    expect(first.code).toBe(3);

    writeFileSync(release, "done");
    // Q7's next `--run`, with time to finish: both daemons answer now and run the files.
    const second = await run(
      f,
      { commit: a, paths, run: RUN, json: true, waitMs: 200_000 },
      options,
    );
    for (const path of paths) {
      const row = rowOf(second.out, path);
      expect(row?.now, `${path} now: ${second.err}`).toMatchObject({ state: "pass" });
      expect(row?.at, `${path} at the commit: ${second.err}`).toMatchObject({ state: "pass" });
    }
    expect(JSON.parse(second.out).now.kind).toBe("daemon");
    expect(second.code).toBe(0);
  });
});
