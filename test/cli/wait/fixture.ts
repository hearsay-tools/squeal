import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { REAL_PORTS, type WaitPorts } from "../../../src/cli/wait/socket.js";
import { WAIT_DOWN_MS } from "../../../src/cli/wait-liveness.js";
import { type SocketState, waitView } from "../../../src/core/presence/wait.js";
import type { CheckId } from "../../../src/core/types/check.js";
import type { AbsolutePath, EpochMs, RevisionNumber } from "../../../src/core/types/common.js";
import type { CheckKey } from "../../../src/core/types/keys.js";
import type { KnownOutcome, PendingPhase, Validity } from "../../../src/core/types/state.js";
import type { DaemonRecord } from "../../../src/core/types/store-records.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../../status/helpers.js";
import { clientGone } from "../fake-daemon.js";

/*
 * Row 011-326: what the wait module's loop rows run on. A scratch store at
 * revision 3, a socket path in a private runtime dir (the existing fake
 * daemon listens there, or a stand-in that holds a request without a word),
 * and a stepped clock: a pause moves it on by its ms at once. Row 011-327:
 * the scratch worktree's daemon heartbeats at the start, and a wait watches
 * it through presence's wait view (`watchDaemon`, or `presenceWatch`).
 */

export const ref = (path: string) => ({ project: "", path: path as never });
const fileCheck = (path: string): CheckId => ({ kind: "file", project: "", testPath: path });

/** A worktree at revision 3 with its store; `config` is its `squeal.config.json`. */
export function scratch(config?: object) {
  const repo = fakeRepo();
  if (config !== undefined) {
    writeFileSync(join(repo.main, "squeal.config.json"), JSON.stringify(config));
  }
  const store = seedStore(repo);
  const id = repo.mainId;
  store.worktrees.upsert({
    id,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  appendRevisions(store, id, 3, { head: null, dirty: false });
  /** Row 011-327: its daemon, its last heartbeat at `heartbeatAt`; `null` clears it, as `squeal stop` does. */
  const daemon = (heartbeatAt: number | null = Date.now()): DaemonRecord | null => {
    const record =
      heartbeatAt === null
        ? null
        : {
            socketPath: socketPath() as AbsolutePath,
            startedAt: (heartbeatAt - 1_000) as EpochMs,
            heartbeatAt: heartbeatAt as EpochMs,
            heartbeatIntervalMs: 5_000,
            squealVersion: "0.0.0-test",
          };
    store.worktrees.setDaemon(id, record);
    return record;
  };
  daemon();
  /** `path` listed, with a test and its file-level check. */
  const file = (
    path: string,
    {
      validity = "current",
      outcome = "pass",
      pending = null,
    }: { validity?: Validity; outcome?: KnownOutcome; pending?: PendingPhase | null } = {},
  ) => {
    const row = { worktreeId: id, testFile: ref(path), key: `key-${path}` as CheckKey };
    store.testFileKeys.upsertMany([{ ...row, revision: 3 as RevisionNumber, pending }]);
    const pendingPhase = validity === "pending" ? ("queued" as const) : null;
    store.knownStates.upsertMany([
      state(id, check(path, "works"), { validity, outcome, pendingPhase, observedAt: 3 }),
      state(id, fileCheck(path), { validity, outcome: "pass", pendingPhase, observedAt: 3 }),
    ]);
  };
  return { root: repo.main, commonDir: repo.commonDir, id, store, file, daemon };
}

/** A clock a pause moves on at once; `onPause` runs after the n-th pause moved it. */
export function steppedClock(start = Date.now()) {
  let at = start;
  const pauses: number[] = [];
  let hook: (n: number) => void = () => {};
  const ports: WaitPorts = {
    now: () => at,
    pause: async (ms) => {
      pauses.push(ms);
      at += ms;
      hook(pauses.length);
    },
    ask: REAL_PORTS.ask,
    watch: REAL_PORTS.watch,
  };
  return {
    ports,
    pauses,
    start,
    at: () => at,
    onPause: (fn: (n: number) => void) => {
      hook = fn;
    },
  };
}

const dirs: string[] = [];
const servers: Server[] = [];
const held: Socket[] = [];

/** A socket path no one listens on yet, in a private runtime dir. */
export function socketPath(): string {
  const dir = mkdtempSync("/tmp/sq-wait-");
  dirs.push(dir);
  return join(dir, "daemon.sock");
}

/** A stand-in that answers each request by `answer`, or holds it without a word at `null`. */
export function stalling(
  path: string,
  answer: (type: string) => Record<string, unknown> | null,
): Promise<void> {
  const server = createServer((socket) => {
    socket.on("error", clientGone);
    socket.once("data", (data) => {
      const { type } = JSON.parse(data.toString()) as { type: string };
      const reply = answer(type);
      if (reply === null) held.push(socket);
      else socket.end(`${JSON.stringify({ schemaVersion: 1, ok: true, type, ...reply })}\n`);
    });
  });
  servers.push(server);
  return new Promise((resolve) => server.listen(path, resolve));
}

/** Closes the stand-ins and removes the runtime dirs; call after each test. */
export function closeLoopFixtures(): void {
  for (const socket of held.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * Review 0.1.469 N2: a socket that takes each request of `types` and gives
 * no answer within its bound, as `askDaemon` meets a busy daemon: an
 * `ETIMEDOUT` error after the bound, with no real time spent. Other
 * requests go to `ports`' own socket.
 */
export function timingOut(ports: WaitPorts, types: readonly string[]): WaitPorts {
  return {
    ...ports,
    ask: async (socketPath, request, timeoutMs) => {
      if (!types.includes(request.type)) return ports.ask(socketPath, request, timeoutMs);
      const ms = timeoutMs ?? 2_000;
      throw Object.assign(new Error(`no answer from ${socketPath} in ${ms} ms`), {
        code: "ETIMEDOUT",
      });
    },
  };
}

/**
 * Row 011-327: a daemon watch on presence's own wait view (`waitView`), its
 * socket check found `socket` at once and no lock marks: a stale heartbeat
 * whose socket holds a daemon (`listening`) is a busy daemon, one nobody
 * listens on (`absent`) is down once the stepped clock passed the
 * heartbeat's grace and `WAIT_DOWN_MS`. `watchDaemon` asks the socket in
 * the background, which a stepped clock does not wait for.
 */
export function presenceWatch(socket: SocketState): WaitPorts["watch"] {
  return () => ({
    judge: (record, at, stopping) =>
      waitView({
        record,
        at,
        stopping,
        marks: () => null,
        socket,
        deadMs: () => 0,
        recordedAgain: () => false,
        downMs: WAIT_DOWN_MS,
      }).liveness,
    lapse: () => null,
  });
}
