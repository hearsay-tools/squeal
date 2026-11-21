import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AtDaemons } from "../../src/cli/status-at-daemons.js";
import { joinRequestAt, recordedAt } from "../../src/cli/status-at-join.js";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { createHandlers } from "../../src/core/daemon/handlers.js";
import { readPolicy } from "../../src/core/daemon/policy.js";
import type { GroupRequested } from "../../src/core/daemon/run-group.js";
import { createDaemonServer } from "../../src/core/daemon/server.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { groupView } from "../../src/core/scheduler/slow.js";
import type { AbsolutePath, RevisionNumber } from "../../src/core/types/common.js";
import type { DaemonRequest } from "../../src/core/types/daemon.js";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { liveDaemon } from "./status-at-daemon.js";
import { check, run, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Review wave-23 B2 (spec 023 D7.3, research `run-wait-model.md` Q7): a
 * `status --at --run` whose narrow requests both daemons recorded, while
 * their scheduler has not taken them (startup or a listing holds them),
 * prints Q7's `--wait 100000` call. That exact call must join them: wait
 * on each recorded request until taken, then on its files, queueing no
 * new run, and never say nothing is queued. The daemons' socket sides are
 * the real handlers on real sockets; only the scheduler is held.
 */

const TEST = ref("test/a.test.ts");
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A daemon's socket side whose scheduler holds every narrow request until `take`. */
async function heldDaemon(socketPath: AbsolutePath) {
  const takes: ((requested: GroupRequested) => void)[] = [];
  const statusAsked: string[] = [];
  let onStatus = () => {};
  const handle = createHandlers({
    worktreeId: "0123456789abcdef" as never,
    root: "/" as never,
    squealVersion: "0.0.0-test",
    startedAt: 1 as never,
    token: "t",
    phase: () => "starting",
    requestFullSuite: () => new Promise(() => {}),
    requestGroup: () => new Promise((resolve) => takes.push(resolve)),
    onActivity: () => {},
    onStop: () => {},
    onStepDown: () => {},
  });
  const server = await createDaemonServer(socketPath, (request: DaemonRequest) => {
    if (request.type === "run-group-status") {
      statusAsked.push(request.requestId);
      onStatus();
    }
    return handle(request);
  });
  cleanups.push(() => server.close());
  return {
    socketPath,
    takes,
    statusAsked,
    /** Resolves once a `run-group-status` came for each request recorded so far. */
    joined: () =>
      new Promise<void>((resolve) => {
        onStatus = () => {
          if (takes.length > 0 && statusAsked.length >= takes.length) resolve();
        };
        onStatus();
      }),
    take: () => {
      for (const take of takes.splice(0)) take({ revision: 3 as RevisionNumber, queued: 1 });
    },
  };
}

async function setUp() {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 1;\n",
    [TEST.path]: testOf("a", 1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: testOf("a", 2) });
  withStore(f, (store) => liveDaemon(f, store, [TEST]));
  const tree = standInTree(f);
  const dir = mkdtempSync(join(tmpdir(), "b2-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const commitDaemon = await heldDaemon(join(dir, "c.sock") as AbsolutePath);
  const ownDaemon = await heldDaemon(join(dir, "w.sock") as AbsolutePath);
  const socketOf = (root: string) =>
    root === tree ? commitDaemon.socketPath : ownDaemon.socketPath;
  const install = linkInstall().install;
  return { f, a, tree, commitDaemon, ownDaemon, socketOf, install };
}

describe(
  "status --at --wait joins requests recorded before the scheduler took them (review wave-23 B2)",
  SLOW,
  () => {
    it("Q7's follow-up waits for both recorded requests, then their files, and queues no run", async () => {
      const { f, a, tree, commitDaemon, ownDaemon, socketOf, install } = await setUp();
      // The first call: each daemon records its narrow request and does not take it (startup).
      const first: AtDaemons = {
        commit: async () => tree,
        find: () => tree,
        worktree: async () => null,
        async ask(root, group, paths, _deadline, call) {
          const request = {
            type: "run-group-paths",
            group,
            paths,
            at: true,
            owner: call.owner,
          } as const;
          await requestDaemon(socketOf(root), { ...request, lead: true }, 2_000);
          return "pending";
        },
        wait: async () => null,
      };
      const options = { cacheRoot: f.cacheRoot, install, daemons: first };
      const queued = await run(
        f,
        { commit: a, paths: [TEST.path], run: { allMissing: false }, json: true },
        options,
      );
      expect(queued.code).toBe(3);
      const report = JSON.parse(queued.out);
      expect(report.run.again).toBe(`squeal status --at ${a} ${TEST.path} --wait 100000`);
      expect([commitDaemon.takes.length, ownDaemon.takes.length]).toEqual([1, 1]);
      const key = (report.files as { path: string; at: { key: string } }[])[0]?.at.key as string;

      // Q7's call, through the real ping and run-group-status; its file wait stores both passes.
      const asked: string[] = [];
      const waits: string[] = [];
      const follow: AtDaemons = {
        commit: async () => {
          asked.push("commit");
          return tree;
        },
        find: () => tree,
        worktree: async () => {
          asked.push("start");
          return null;
        },
        ask: async () => {
          asked.push("ask");
          return "taken";
        },
        async wait(root, files) {
          waits.push(root);
          const id = worktreeIdFor((root === tree ? tree : f.root) as AbsolutePath);
          const keyOf = (path: string) => (root === tree ? key : `daemon-${path}`);
          withStore(f, (store) =>
            store.results.putMany(
              files.map((file) => result(check(file.path), keyOf(file.path), { worktreeId: id })),
            ),
          );
          return null;
        },
        recorded: (root, deadline) => recordedAt(socketOf(root), deadline),
        joinRequest: (root, request, deadline) => joinRequestAt(socketOf(root), request, deadline),
      };
      const call = run(
        f,
        { commit: a, paths: [TEST.path], waitMs: 100_000 },
        { ...options, daemons: follow },
      );
      // Observed barrier: the call asks after both held requests; until they are taken it waits.
      const barrier = Promise.all([commitDaemon.joined(), ownDaemon.joined()]).then(() => "joined");
      expect(await Promise.race([barrier, call.then((ended) => ended.out)])).toBe("joined");
      expect(waits).toEqual([]);
      commitDaemon.take();
      ownDaemon.take();
      const joined = await call;
      expect(joined.out).not.toContain("nothing is queued");
      expect(asked).toEqual([]);
      expect([commitDaemon.takes.length, ownDaemon.takes.length]).toEqual([0, 0]);
      expect(waits.sort()).toEqual([tree, f.root].sort());
      expect(joined.out).toContain(
        `--wait: joined 1 test files with no result at ${a.slice(0, 9)}`,
      );
      expect(joined.out).toContain("--wait, now: joined 1 test files");
      expect(joined.code).toBe(0);
    });

    it("a request still recorded at the deadline keeps its files queued, with Q7's line", async () => {
      const { f, a, tree, commitDaemon, ownDaemon, socketOf, install } = await setUp();
      const group = groupView(readPolicy(f.root)).of(TEST).name;
      for (const daemon of [commitDaemon, ownDaemon])
        await requestDaemon(
          daemon.socketPath,
          { type: "run-group-paths", group, paths: [TEST.path], at: true },
          2_000,
        );
      const waits: string[] = [];
      const daemons: AtDaemons = {
        commit: async () => ({ problem: "must not start" }),
        find: () => tree,
        worktree: async () => "must not start",
        ask: async () => ({ problem: "must not ask" }),
        wait: async (root) => {
          waits.push(root);
          return null;
        },
        recorded: (root, deadline) => recordedAt(socketOf(root), deadline),
        joinRequest: (root, request, deadline) => joinRequestAt(socketOf(root), request, deadline),
      };
      const options = { cacheRoot: f.cacheRoot, install, daemons };
      const text = await run(f, { commit: a, paths: [TEST.path], waitMs: 0 }, options);
      expect(text.code).toBe(3);
      expect(waits).toEqual([]);
      expect(text.out).not.toContain("nothing is queued");
      // Q7's line; whether it ends the report is S2's (the stale pre-wait `--run` advice).
      expect(text.out).toContain(
        `1 still running at ${a.slice(0, 9)} (its worktree), 1 in the working tree; their runs go on in the daemons. squeal status --at ${a} ${TEST.path} --wait 100000 waits for them; squeal ps shows them.`,
      );
    });
  },
);
