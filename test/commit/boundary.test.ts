import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HEAD_MOVE_WAIT_MS, syncOnHeadMove } from "../../src/core/commit/boundary.js";
import { writeCommitReports } from "../../src/core/commit/store.js";
import type { Store } from "../../src/core/types/store.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { recorded, squealRepo } from "../harness/helpers.js";

/*
 * Row 019-13 (spec 019 D5): the tool boundary reads `HEAD` from the git dir
 * with no spawn and asks the daemon for a `sync` pass when it moved since
 * the daemon last looked, so a commit's report is not 30 s late. A read-only
 * tool batch asks nothing. Row 019-29 (lessons round 1, P2 option a): the
 * boundary that asked waits up to `HEAD_MOVE_WAIT_MS` for the pass to end,
 * since the pass stores the report before it answers; one that did not ask
 * waits for nothing.
 */

const SHA_1 = "1".repeat(40);
const SHA_2 = "2".repeat(40);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** What the fake daemon answers to one request, by its type and how many came before it. */
type Answer = (type: string, seen: number) => object;

/** An unknown request's answer: an error. */
const REFUSED: Answer = () => ({ schemaVersion: 1, ok: false, error: "test" });

/** A `sync` answer of request `r1`, its pass not ended. */
const PENDING = {
  schemaVersion: 1,
  ok: true,
  type: "sync",
  requestId: "r1",
  revision: null,
  error: null,
};

/** A socket that records each request's type and answers with `answer`. */
async function daemonSocket(answer: Answer = REFUSED): Promise<{ path: string; types: string[] }> {
  // Socket paths are limited to 108 bytes; the test temp dir can be longer.
  const dir = mkdtempSync("/tmp/sq-sync-");
  const path = join(dir, "d.sock");
  const types: string[] = [];
  const server = createServer((socket) => {
    // A client past its bound closes its end first; the real daemon ignores that reset too.
    socket.on("error", () => undefined);
    socket.once("data", (data) => {
      const type = (JSON.parse(String(data).split("\n")[0] ?? "{}") as { type: string }).type;
      types.push(type);
      socket.end(`${JSON.stringify(answer(type, types.length - 1))}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  cleanups.push(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { path, types };
}

/** A worktree whose store's latest revision is at `SHA_1`, its daemon live at `socket`. */
function worktree(socket: string) {
  const r = squealRepo();
  r.store.revisions.append({
    worktreeId: r.worktreeId,
    createdAt: 1,
    head: SHA_1,
    dirty: false,
    trigger: "watch",
    changes: [{ path: "src/math.ts", oldHash: null, newHash: "h1" }],
  });
  r.store.worktrees.setDaemon(r.worktreeId, {
    socketPath: socket,
    startedAt: 1,
    heartbeatAt: Date.now(),
    heartbeatIntervalMs: 3_600_000,
    squealVersion: "0.0.0-test",
  });
  const heads = join(r.repo.commonDir, "refs", "heads");
  mkdirSync(heads, { recursive: true });
  const commit = (sha: string) => writeFileSync(join(heads, "main"), `${sha}\n`);
  return { ...r, commit };
}

const sync = (store: Store, r: { worktreeId: string; root: string }) =>
  syncOnHeadMove(store, r.worktreeId, r.root, { socketMs: 2_000 });

describe("syncOnHeadMove at the tool boundary (019-13)", () => {
  it("asks for a pass when HEAD moved since the revision the store records", async () => {
    const socket = await daemonSocket();
    const r = worktree(socket.path);
    r.commit(SHA_1);
    expect(await sync(r.store, r)).toBe(false);
    r.commit(SHA_2);
    expect(await sync(r.store, r)).toBe(true);
    expect(socket.types).toEqual(["sync"]);
  });

  it("compares with the HEAD the daemon's commit reports last looked at, once it wrote one", async () => {
    const socket = await daemonSocket();
    const r = worktree(socket.path);
    r.commit(SHA_2);
    writeCommitReports(r.store.meta, r.worktreeId, SHA_2);
    expect(await sync(r.store, r)).toBe(false);
    // A watch revision recorded the new HEAD, but the daemon has not looked since.
    writeCommitReports(r.store.meta, r.worktreeId, SHA_1);
    r.commit(SHA_1);
    expect(await sync(r.store, r)).toBe(false);
    r.commit(SHA_2);
    expect(await sync(r.store, r)).toBe(true);
    expect(socket.types).toEqual(["sync"]);
  });

  it("asks nothing with an unborn HEAD, or with no daemon recorded; a daemon not listening is no error", async () => {
    const socket = await daemonSocket();
    const r = worktree(socket.path);
    expect(await sync(r.store, r)).toBe(false);
    r.commit(SHA_2);
    r.store.worktrees.setDaemon(r.worktreeId, null);
    expect(await sync(r.store, r)).toBe(false);
    r.store.worktrees.setDaemon(r.worktreeId, {
      socketPath: join(socket.path, "..", "nobody.sock"),
      startedAt: 1,
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 3_600_000,
      squealVersion: "0.0.0-test",
    });
    expect(await sync(r.store, r)).toBe(true);
    expect(socket.types).toEqual([]);
  });
});

describe("the wait for the pass that reports a commit (019-29)", () => {
  /** `PENDING` until `ends` requests came; then the pass ended at revision 2. */
  const endsAfter =
    (ends: number): Answer =>
    (_type, seen) =>
      seen < ends ? PENDING : { ...PENDING, revision: 2 };
  const moved = async (answer: Answer) => {
    const socket = await daemonSocket(answer);
    const r = worktree(socket.path);
    r.commit(SHA_2);
    return { socket, r };
  };

  it("asks for the pass's state until it ended, then returns", async () => {
    const { socket, r } = await moved(endsAfter(3));
    expect(await sync(r.store, r)).toBe(true);
    expect(socket.types).toEqual(["sync", "sync-status", "sync-status", "sync-status"]);
  });

  it(`stops waiting after ${HEAD_MOVE_WAIT_MS} ms when the pass does not end, well inside the hook's 2 s`, async () => {
    const { socket, r } = await moved(() => PENDING);
    const started = performance.now();
    expect(await sync(r.store, r)).toBe(true);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(HEAD_MOVE_WAIT_MS - 1);
    expect(elapsed).toBeLessThan(HEAD_MOVE_WAIT_MS + 1_000);
    expect(socket.types[0]).toBe("sync");
    expect(new Set(socket.types.slice(1))).toEqual(new Set(["sync-status"]));
  });

  it("waits for nothing when the pass ended at once, the daemon refuses the sync, or it forgot the request", async () => {
    for (const [answer, types] of [
      [endsAfter(0), ["sync"]],
      [REFUSED, ["sync"]],
      [
        (type: string) =>
          type === "sync"
            ? PENDING
            : { schemaVersion: 1, ok: false, error: "unknown request id r1" },
        ["sync", "sync-status"],
      ],
    ] as const) {
      const { socket, r } = await moved(answer);
      expect(await sync(r.store, r)).toBe(true);
      expect(socket.types).toEqual(types);
    }
  });
});

describe("Claude Code PostToolBatch after a commit (019-13)", () => {
  const deps: HookDeps = {
    env: { CLAUDE_CODE_SESSION_ATTENDED: "1", CLAUDE_CODE_ENTRYPOINT: "cli" },
    ensureDaemon: async () => "alive",
    squealVersion: "0.0.0-test",
  };
  const batch = (root: string, tool: string) =>
    recorded("post-tool-batch", root, {
      tool_calls: [{ tool_name: tool, tool_input: {}, tool_use_id: "t1" }],
    });

  it("a Bash batch asks for a sync pass when HEAD moved; a read-only batch does not; nothing is denied", async () => {
    const socket = await daemonSocket();
    const r = worktree(socket.path);
    r.commit(SHA_1);
    await runHook("session-start", recorded("session-start", r.root), deps);
    r.commit(SHA_2);

    const read = await runHook("post-tool-batch", batch(r.root, "Read"), deps);
    expect(socket.types).not.toContain("sync");
    const bash = await runHook("post-tool-batch", batch(r.root, "Bash"), deps);
    expect(socket.types.filter((t) => t === "sync")).toEqual(["sync"]);
    for (const out of [read, bash]) {
      expect(out.exitCode).toBe(0);
      expect(out.stdout).not.toMatch(/"decision"|permissionDecision|"block"/);
    }
  });

  it("a Bash batch after a commit waits for the pass; once it reported the HEAD, the next batch asks and waits for nothing (019-29)", async () => {
    const socket = await daemonSocket(() => PENDING);
    const r = worktree(socket.path);
    r.commit(SHA_1);
    await runHook("session-start", recorded("session-start", r.root), deps);
    r.commit(SHA_2);

    const started = performance.now();
    const commit = await runHook("post-tool-batch", batch(r.root, "Bash"), deps);
    expect(performance.now() - started).toBeGreaterThanOrEqual(HEAD_MOVE_WAIT_MS - 1);
    expect(commit.exitCode).toBe(0);
    expect(socket.types[0]).toBe("sync");

    // The pass stored the report of SHA_2: no HEAD move is left, so no request, so no wait.
    writeCommitReports(r.store.meta, r.worktreeId, SHA_2);
    const asked = socket.types.length;
    const after = await runHook("post-tool-batch", batch(r.root, "Bash"), deps);
    expect(after.exitCode).toBe(0);
    expect(socket.types).toHaveLength(asked);
  });
});
