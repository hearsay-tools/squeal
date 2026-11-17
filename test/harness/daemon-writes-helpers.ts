import { mkdtempSync, rmSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { vi } from "vitest";
import { createHandlers } from "../../src/core/daemon/handlers.js";
import { createDaemonServer } from "../../src/core/daemon/server.js";
import { decodeBatch, writeBatch } from "../../src/core/daemon/write-batch.js";
import { openStore } from "../../src/core/store/open.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { AbsolutePath, EpochMs } from "../../src/core/types/common.js";
import type { SentBatch } from "../../src/core/types/daemon-writes.js";
import type { Store } from "../../src/core/types/store.js";
import type { SquealRepo } from "./helpers.js";

/*
 * Spec 021 D15 (row 021-16): a daemon's socket for a fixture repository,
 * served in this process by the daemon's own handlers and write desk, with
 * its own store connection writing each batch as the daemon's main thread
 * does (`writeBatch`), and recorded in the store as the worktree's daemon
 * with a fresh heartbeat. Hooks run in this process then take its path.
 */

export interface ServedWrites {
  /** The daemon's store connection: its writes are the daemon's. */
  readonly store: Store;
  /** Each batch the daemon wrote, in order. */
  readonly batches: SentBatch[];
  /** Write statements the daemon ran. */
  readonly statements: () => number;
  /** Holds every batch until `release`; written in order once released. */
  pause(): void;
  /** The batches `pause` holds now, in order. */
  held(): readonly SentBatch[];
  release(): void;
  /**
   * Review 0.1.546 B1: the daemon stops answering at all, as one stopped with SIGSTOP: no
   * lease, write or ping gets an answer until `thaw`. Only with `serveWrites`'s `freezable`.
   */
  freeze(): void;
  thaw(): void;
  close(): Promise<void>;
}

export async function serveWrites(
  r: SquealRepo,
  { freezable = false }: { readonly freezable?: boolean } = {},
): Promise<ServedWrites> {
  const dir = mkdtempSync(join(tmpdir(), "sq-w-"));
  const socketPath = join(dir, "d.sock") as AbsolutePath;
  const store = openStore(r.repo.commonDir as AbsolutePath);
  if ("reason" in store) throw new Error(`no store: ${store.reason}`);
  const batches: SentBatch[] = [];
  let statements = 0;
  let paused: (() => void)[] | null = null;
  let held: SentBatch[] = [];
  const handle = createHandlers({
    worktreeId: r.worktreeId,
    root: r.root as AbsolutePath,
    squealVersion: "0.0.0-test",
    startedAt: 1 as EpochMs,
    token: "t",
    phase: () => "ready",
    requestFullSuite: () => Promise.reject(new Error("not in this test")),
    onActivity: () => {},
    onStop: () => {},
    onStepDown: () => {},
    storeSchema: store.schemaVersion,
    requestWrite: async (batch) => {
      if (paused !== null) {
        held.push(batch);
        await new Promise<void>((resolve) => paused?.push(resolve));
      }
      const decoded = decodeBatch(batch);
      writeBatch(store, decoded);
      batches.push(batch);
      statements += decoded.length;
    },
  });
  const server = await createDaemonServer(socketPath, handle);
  const gate = freezable ? await frozenGate(socketPath, join(dir, "f.sock") as AbsolutePath) : null;
  r.store.worktrees.setDaemon(r.worktreeId, {
    socketPath: gate?.socketPath ?? socketPath,
    startedAt: 1 as EpochMs,
    heartbeatAt: Date.now() as EpochMs,
    heartbeatIntervalMs: 3_600_000,
    squealVersion: "0.0.0-test",
  });
  return {
    store,
    batches,
    statements: () => statements,
    pause: () => {
      paused ??= [];
    },
    held: () => held,
    release: () => {
      const waiting = paused ?? [];
      paused = null;
      held = [];
      for (const resolve of waiting) resolve();
    },
    freeze: () => {
      if (gate === null) throw new Error("serveWrites: not freezable");
      gate.frozen = true;
    },
    thaw: () => gate?.thaw(),
    close: async () => {
      gate?.thaw();
      await gate?.close();
      await server.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * A socket at `socketPath` that passes each connection to `upstream`, and while `frozen` holds
 * every byte both ways, as a stopped daemon's socket buffers them; `thaw` passes them on.
 */
async function frozenGate(upstream: AbsolutePath, socketPath: AbsolutePath) {
  const held: (() => void)[] = [];
  const sockets = new Set<Socket>();
  const gate = {
    socketPath,
    frozen: false,
    thaw: () => {
      gate.frozen = false;
      for (const pass of held.splice(0)) pass();
    },
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  const pass = (from: Socket, to: Socket) => {
    from.on("data", (chunk) => {
      const send = () => {
        if (!to.destroyed) to.write(chunk);
      };
      if (gate.frozen) held.push(send);
      else send();
    });
    from.on("end", () => {
      const end = () => to.end();
      if (gate.frozen) held.push(end);
      else end();
    });
    from.on("error", () => to.destroy());
    from.on("close", () => to.destroy());
  };
  const server: Server = createServer((client) => {
    const daemon = connect(upstream);
    for (const socket of [client, daemon]) sockets.add(socket);
    pass(client, daemon);
    pass(daemon, client);
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return gate;
}

/** What this process wrote to `store.sqlite` files while it counted (`countWrites`). */
export interface WriteCount {
  /** Write transactions opened on a connection that is not `daemon`'s. */
  readonly transactions: number;
  /** Connections other than `daemon`'s made writable (`query_only` off). */
  readonly madeWritable: number;
  /** Write statements run on any connection, the daemon's included. */
  readonly statements: number;
}

/**
 * Counts the writes this process makes to `store.sqlite` until `stop`:
 * write transactions and `query_only` switches on any connection but the
 * daemon's (`daemon`), and write statements on every connection. A
 * statement cannot be traced to its connection, so a test compares their
 * number with the statements the daemon ran.
 */
export function countWrites(daemon: Store): { stop(): WriteCount } {
  const daemonDb = connectionOf(daemon).db;
  const exec = DatabaseSync.prototype.exec;
  const run = StatementSync.prototype.run;
  let transactions = 0;
  let madeWritable = 0;
  let statements = 0;
  const isStore = (db: DatabaseSync) => (db.location() ?? "").endsWith("store.sqlite");
  const execSpy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    if (this !== daemonDb && isStore(this)) {
      if (/^\s*BEGIN\s+IMMEDIATE/i.test(sql)) transactions++;
      if (/query_only\s*=\s*0/i.test(sql)) madeWritable++;
    }
    return exec.call(this, sql);
  });
  const runSpy = vi.spyOn(StatementSync.prototype, "run").mockImplementation(function (
    this: StatementSync,
    ...params: unknown[]
  ) {
    if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(this.sourceSQL)) statements++;
    return run.apply(this, params as Parameters<StatementSync["run"]>);
  });
  return {
    stop: () => {
      execSpy.mockRestore();
      runSpy.mockRestore();
      return { transactions, madeWritable, statements };
    },
  };
}
