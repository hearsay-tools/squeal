import { DatabaseSync } from "node:sqlite";
import type { Statement } from "../../src/core/daemon/write-batch.js";
import { SendingConnection, type WriteSender } from "../../src/core/delivery/sending-connection.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { Store } from "../../src/core/types/store.js";

/*
 * Spec 021 D15 for tests: a hook's store over a `SendingConnection` whose writes go to a fake
 * daemon, which writes each batch to the store file and logs each request it is sent.
 */

/** A hook's store whose writes go to the fake daemon, and the daemon's request log. */
export interface SentFixture {
  readonly store: Store;
  readonly connection: SendingConnection;
  /** `lease`, `write`, `write+release` and `release`, in the order sent. */
  readonly log: string[];
  /** `SendingConnection.unit` with the fake daemon's lease. */
  write<T>(work: () => T | Promise<T>): Promise<T>;
  close(): void;
}

/** Opens the store at `commonDir`, which must exist, as a hook does while a daemon serves. */
export function sentStore(commonDir: string): SentFixture {
  const db = new DatabaseSync(storePaths(commonDir).database);
  db.exec("PRAGMA busy_timeout = 10000");
  const log: string[] = [];
  const sender: WriteSender & { leased: boolean } = {
    leased: false,
    send: async (batch: readonly Statement[], release: boolean) => {
      log.push(release ? "write+release" : "write");
      db.exec("BEGIN IMMEDIATE");
      for (const { sql, params } of batch) db.prepare(sql).run(...(params as never[]));
      db.exec("COMMIT");
      if (release) sender.leased = false;
      return "written";
    },
    release: async () => {
      log.push("release");
      sender.leased = false;
    },
  };
  const acquire = async () => {
    log.push("lease");
    sender.leased = true;
    return true;
  };
  let made: SendingConnection | null = null;
  const store = openStore(commonDir, {
    create: false,
    busyTimeoutMs: 10_000,
    connection: (opened) => {
      made = new SendingConnection(opened, sender);
      return made;
    },
  });
  if (isStoreOpenFailure(store) || made === null) throw new Error("the store did not open");
  const connection: SendingConnection = made;
  return {
    store,
    connection,
    log,
    write: (work) => connection.unit(work, acquire),
    close: () => {
      store.close();
      db.close();
    },
  };
}
