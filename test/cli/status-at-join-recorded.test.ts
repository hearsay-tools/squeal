import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AtDaemons, realDaemons } from "../../src/cli/status-at-daemons.js";
import { joinRequestAt, recordedAt } from "../../src/cli/status-at-join.js";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { CommitDesk } from "../../src/core/daemon/commit-desk.js";
import { createHandlers } from "../../src/core/daemon/handlers.js";
import { readPolicy } from "../../src/core/daemon/policy.js";
import type { GroupRequested } from "../../src/core/daemon/run-group.js";
import { createDaemonServer } from "../../src/core/daemon/server.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { groupView } from "../../src/core/scheduler/slow.js";
import type { CommitAskRequest } from "../../src/core/types/commit-ask.js";
import type { AbsolutePath, RevisionNumber } from "../../src/core/types/common.js";
import type { DaemonRequest } from "../../src/core/types/daemon.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { liveDaemon } from "./status-at-daemon.js";
import { check, run, standInTree, testOf, withStore } from "./status-at-kit.js";
import { keyedNow } from "./status-at-now-stand-in.js";

/*
 * Review wave-23 B2 (spec 023 D7.3, research `run-wait-model.md` Q7; row
 * 023-40c): a `status --at --run` whose work both daemons recorded while
 * they cannot take it yet (the commit daemon still sets up; the worktree's
 * scheduler holds its narrow request) prints Q7's `--wait 100000` call.
 * That exact call must join them: read the commit daemon's kept ask until
 * it is queued and wait on each recorded narrow request until taken, then
 * on their files, queueing no new run, and never say nothing is queued.
 * The daemons' socket sides are the real handlers on real sockets (the
 * commit daemon's with its real `CommitDesk`); only their main threads are
 * held.
 */

const TEST = ref("test/a.test.ts");
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * A daemon's socket side whose scheduler holds every narrow request until
 * `take`; a commit daemon's asks wait in its `CommitDesk` until `ready`.
 */
async function heldDaemon(socketPath: AbsolutePath) {
  const takes: ((requested: GroupRequested) => void)[] = [];
  const statusAsked: string[] = [];
  const asks: CommitAskRequest[] = [];
  let reads = 0;
  let onStatus = () => {};
  const desk = new CommitDesk((request) => asks.push(request));
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
    commitDesk: desk,
  });
  const server = await createDaemonServer(socketPath, (request: DaemonRequest) => {
    if (request.type === "run-group-status") statusAsked.push(request.requestId);
    if (request.type === "commit-read") reads += 1;
    onStatus();
    return handle(request);
  });
  cleanups.push(() => server.close());
  return {
    socketPath,
    takes,
    asks,
    /** Resolves once the daemon was asked after what it holds: a status of each request, or a read. */
    joined: (by: "status" | "read") =>
      new Promise<void>((resolve) => {
        const before = reads;
        onStatus = () => {
          if (
            by === "read" ? reads > before : takes.length > 0 && statusAsked.length >= takes.length
          )
            resolve();
        };
        onStatus();
      }),
    take: () => {
      for (const take of takes.splice(0)) take({ revision: 3 as RevisionNumber, queued: 1 });
    },
    /** The main thread's snapshot: set up, each ask queued with `files`. */
    ready: (files: readonly TestFileRef[]) =>
      desk.set({
        setup: { phase: "ready" },
        asks: asks.map((ask) => ({
          owner: ask.owner,
          phase: "queued",
          files,
          readers: {},
          problems: [],
        })),
      }),
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
  // The commit daemon's row for the file, once it keyed it.
  withStore(f, (store) =>
    store.testFileKeys.upsertMany([
      {
        worktreeId: worktreeIdFor(tree),
        testFile: TEST,
        key: `commit-${TEST.path}`,
        revision: 2,
        pending: "queued",
      },
    ]),
  );
  const dir = mkdtempSync(join(tmpdir(), "b2-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const commitDaemon = await heldDaemon(join(dir, "c.sock") as AbsolutePath);
  const ownDaemon = await heldDaemon(join(dir, "w.sock") as AbsolutePath);
  const socketOf = (root: string) =>
    root === tree ? commitDaemon.socketPath : ownDaemon.socketPath;
  const install = linkInstall().install;
  // The real daemons' requests, over these sockets; no daemon is started.
  const real = realDaemons({ socket: async (root) => socketOf(root) });
  return { f, a, tree, commitDaemon, ownDaemon, socketOf, install, real };
}

describe(
  "status --at --wait joins work recorded before the daemons took it (review wave-23 B2)",
  SLOW,
  () => {
    it("Q7's follow-up waits for the commit daemon's ask and the recorded request, then their files, and queues no run", async () => {
      const { f, a, tree, commitDaemon, ownDaemon, socketOf, install, real } = await setUp();
      // The first call: the commit daemon keeps its ask (it still installs); the worktree's
      // daemon records its narrow request and does not take it (startup).
      const first: AtDaemons = {
        ...real,
        commit: async () => tree,
        find: () => tree,
        now: keyedNow,
        worktree: async () => null,
        async ask(root, group, paths) {
          const request = { type: "run-group-paths", group, paths, at: true } as const;
          await requestDaemon(socketOf(root), { ...request, lead: true }, 2_000);
          return "pending";
        },
        wait: async () => null,
      };
      const options = { cacheRoot: f.cacheRoot, install, daemons: first };
      const queued = await run(
        f,
        { commit: a, paths: [TEST.path], run: { allMissing: false }, json: true, waitMs: 3000 },
        options,
      );
      expect(queued.code).toBe(3);
      const report = JSON.parse(queued.out);
      expect(report.run.again).toBe(`squeal status --at ${a} ${TEST.path} --wait 100000`);
      expect(report.run.commit.setup).toBe("install");
      expect([commitDaemon.asks.length, ownDaemon.takes.length]).toEqual([1, 1]);

      // Q7's call, through the real reads, ping and run-group-status; its file wait stores both passes.
      const asked: string[] = [];
      const waits: string[] = [];
      const follow: AtDaemons = {
        ...real,
        commit: async () => {
          asked.push("commit");
          return tree;
        },
        commitAsk: async () => {
          asked.push("commit-ask");
          return null;
        },
        find: () => tree,
        now: keyedNow,
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
          const keyOf = (path: string) => (root === tree ? `commit-${path}` : `daemon-${path}`);
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
      // Observed barrier: the call reads the kept ask and asks after the held request; it waits.
      const barrier = Promise.all([commitDaemon.joined("read"), ownDaemon.joined("status")]).then(
        () => "joined",
      );
      expect(await Promise.race([barrier, call.then((ended) => ended.out)])).toBe("joined");
      expect(waits).toEqual([]);
      commitDaemon.ready([TEST]);
      ownDaemon.take();
      const joined = await call;
      expect(joined.out).not.toContain("nothing is queued");
      expect(asked).toEqual([]);
      expect(ownDaemon.takes.length).toBe(0);
      expect(waits.sort()).toEqual([tree, f.root].sort());
      expect(joined.out).toContain(
        `--wait: joined 1 test files with no result at ${a.slice(0, 9)}`,
      );
      expect(joined.out).toContain("--wait, now: joined 1 test files");
      expect(joined.code).toBe(0);
    });

    it("work still recorded at the deadline stays queued, with Q7's line", async () => {
      const { f, a, tree, commitDaemon, ownDaemon, socketOf, install, real } = await setUp();
      const group = groupView(readPolicy(f.root)).of(TEST).name;
      await requestDaemon(
        ownDaemon.socketPath,
        { type: "run-group-paths", group, paths: [TEST.path], at: true },
        2_000,
      );
      await requestDaemon(
        commitDaemon.socketPath,
        {
          type: "commit-ask",
          owner: "earlier",
          changed: [],
          named: [TEST.path],
          allMissing: false,
        },
        2_000,
      );
      const waits: string[] = [];
      const daemons: AtDaemons = {
        ...real,
        commit: async () => ({ problem: "must not start" }),
        commitAsk: async () => "must not ask",
        find: () => tree,
        now: keyedNow,
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
      // The held request was never taken: its files are not waited for.
      expect(waits).not.toContain(f.root);
      expect(text.out).not.toContain("nothing is queued");
      // Q7's line, with the commit daemon still setting up.
      expect(text.out).toContain(
        `still setting up at ${a.slice(0, 9)} (install), 1 in the working tree; their runs go on in the daemons. squeal status --at ${a} ${TEST.path} --wait 100000 waits for them; squeal ps shows them.`,
      );
    });
  },
);
