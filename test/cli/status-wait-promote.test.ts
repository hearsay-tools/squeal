import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { type NamedWaitOptions, waitForNamed } from "../../src/cli/status-wait-paths.js";
import { promoteNamed } from "../../src/cli/status-wait-promote.js";
import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import type { RevisionNumber, TestFileRef } from "../../src/core/types/index.js";
import { A, B, finish, later, NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Spec 011 C15 (task 011-11): a named wait sends `promote` once, beside the
 * first read whose selection is decided, with the test files named by their
 * own paths and what is left of the wait. A source path's selection is not
 * promoted, and a daemon that does not know the request changes nothing.
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const synced: SyncState = { state: "synced", revision: 4 as RevisionNumber, incarnation: null };

type Sent = { files: readonly TestFileRef[]; withinMs: number };

function options(sync: () => SyncState, sent: Sent[], timeoutMs = 5_000): NamedWaitOptions {
  return {
    timeoutMs,
    pollMs: 20,
    settleMs: 100,
    now: () => NOW,
    sync: (): DaemonSync => ({ current: sync, stop: () => {} }),
    promote: (_root, files, withinMs) => sent.push({ files, withinMs }),
  };
}

describe("a named wait's promote request (spec 011 C15)", () => {
  it("sends the named test file once its selection is decided, with the time left", async () => {
    const { repo, store } = repoWith([A, B]);
    const sent: Sent[] = [];
    let state: SyncState = { state: "pending" };
    later(150, () => {
      expect(sent).toEqual([]);
      state = synced;
    });
    later(400, () => finish(store, repo.mainId, A));
    const wait = await waitForNamed(
      repo.main,
      [A],
      options(() => state, sent),
    );
    expect(wait.outcome).toBe("settled");
    expect(sent.map((s) => s.files)).toEqual([[ref(A)]]);
    const [first] = sent;
    expect(first?.withinMs).toBeGreaterThan(4_000);
    expect(first?.withinMs).toBeLessThanOrEqual(5_000);
  });

  it("promotes nothing for a source path, whose selection is its consumers", async () => {
    const { repo, store } = repoWith([A, B]);
    for (const path of [A, B]) {
      store.testFiles.put({
        testFile: ref(path),
        closure: {
          testFile: ref(path),
          paths: [path, "src/shared.ts"].sort() as never,
          complete: false,
          method: CLOSURE_METHOD,
        },
        updatedAt: NOW,
        updatedBy: repo.mainId,
      });
    }
    const sent: Sent[] = [];
    const wait = await waitForNamed(
      repo.main,
      ["src/shared.ts", A],
      options(() => synced, sent, 300),
    );
    if (wait.outcome === "unavailable") throw new Error("unavailable");
    expect(wait.selection.files.map((f) => f.path).sort()).toEqual([A, B]);
    // Only A, named by its own path; B is selected through the source path alone.
    expect(sent.map((s) => s.files)).toEqual([[ref(A)]]);
  });

  it("sends nothing when the first decided read settles the wait", async () => {
    const { repo } = repoWith([B], [A]);
    const sent: Sent[] = [];
    const wait = await waitForNamed(
      repo.main,
      [A],
      options(() => synced, sent),
    );
    expect(wait.outcome).toBe("settled");
    expect(sent).toEqual([]);
  });
});

/** A socket at `path` that answers pings as a daemon and `promote` with `answer`. */
async function daemonAt(path: string, answer: (request: unknown) => unknown): Promise<Server> {
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.once("data", (line: string) => {
      const request = JSON.parse(line) as { type: string };
      const ping = { schemaVersion: 1, ok: true, type: "ping", phase: "ready" };
      socket.end(`${JSON.stringify(request.type === "ping" ? ping : answer(request))}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  return server;
}

describe("promoteNamed", () => {
  function recorded(socketPath: string) {
    const { repo, store } = repoWith([A]);
    const row = store.worktrees.get(repo.mainId);
    if (row?.daemon == null) throw new Error("no daemon row");
    const now = Date.now();
    store.worktrees.upsert({
      ...row,
      daemon: { ...row.daemon, socketPath, startedAt: now - 1_000, heartbeatAt: now },
    });
    return repo.main;
  }

  function socketDir(): string {
    const dir = mkdtempSync("/tmp/sq-promote-cli-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    return join(dir, "d.sock");
  }

  it("asks the worktree's daemon to promote the files for the time left", async () => {
    const socketPath = socketDir();
    const requests: unknown[] = [];
    await daemonAt(socketPath, (request) => {
      requests.push(request);
      return { schemaVersion: 1, ok: true, type: "promote" };
    });
    promoteNamed(recorded(socketPath) as never, [ref(A)], 1_234.6);
    await expect
      .poll(() => requests)
      .toEqual([{ type: "promote", testFiles: [ref(A)], withinMs: 1_235 }]);
  });

  it("leaves an older daemon's unknown-request answer alone, and sends nothing without files", async () => {
    const socketPath = socketDir();
    const requests: unknown[] = [];
    await daemonAt(socketPath, (request) => {
      requests.push(request);
      return { schemaVersion: 1, ok: false, error: 'unknown request type "promote"' };
    });
    const root = recorded(socketPath) as never;
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    cleanups.push(() => process.off("unhandledRejection", onUnhandled));
    promoteNamed(root, [], 1_000);
    promoteNamed(root, [ref(A)], 1_000);
    await expect.poll(() => requests.length).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(unhandled).toEqual([]);
  });
});
