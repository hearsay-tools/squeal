import { renameSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { claimHandoff, endHandoff, handoffFrom } from "../../src/core/delivery/handoff.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import type {
  DaemonRecord,
  DaemonRequest,
  EpochMs,
  Store,
  WorktreeId,
} from "../../src/core/types/index.js";
import { daemonSuite, type FixtureRepo, SLOW } from "./helpers.js";
import { spawnLog, startIn } from "./start-helpers.js";

/*
 * Row 011-151 (review 0.1.277-r2, B1, applied to `replaceShort`): `squeal
 * start` asks a daemon that ended its handoff short to step down. Another
 * daemon that binds the reused socket path between start's ping and its
 * step-down is asked nothing and stopped by nothing. Stand-ins rename their
 * socket over the path, as `bindAt` does.
 */

const suite = daemonSuite();
const OLDER = "0.1.1";
/** `start`'s pings before its step-down: `stoppingDaemon`'s, its status read's, then `replaceShort`'s. */
const PINGS_BEFORE_STEP_DOWN = 3;

/** A short daemon of `OLDER` started at `startedAt`, on `repo`'s socket path. */
function shortAt(repo: FixtureRepo, startedAt: number, token: string): DaemonRecord {
  return {
    socketPath: repo.socketPath as never,
    startedAt: startedAt as EpochMs,
    heartbeatAt: Date.now() as EpochMs,
    heartbeatIntervalMs: 3_600_000,
    squealVersion: OLDER,
    token,
  };
}

/** Records `record` as the worktree's daemon, registered short under a claim to a newer version. */
function registersShort(store: Store, repo: FixtureRepo, record: DaemonRecord): void {
  const id = repo.worktreeId as WorktreeId;
  const at = Date.now() as EpochMs;
  store.transaction(() => {
    claimHandoff(store, id, { from: "0.1.0@1#old", to: "9.9.9", at });
    store.worktrees.setDaemon(id, record);
    endHandoff(store, id, { of: handoffFrom(record), version: OLDER, executable: "x", at });
  });
}

/**
 * A stand-in daemon of `record` that accepts every step-down, listening at a
 * staging name; `bind` renames it over the socket path. `afterPing` runs
 * after each ping it answers, with the number answered.
 */
async function standIn(
  repo: FixtureRepo,
  record: DaemonRecord,
  afterPing: (pings: number) => void = () => {},
): Promise<{ asked: string[]; bind: () => void }> {
  const staging = join(dirname(repo.socketPath), `.s${record.token}`);
  const asked: string[] = [];
  const server = createServer((socket) => {
    socket.on("error", () => {});
    socket.once("data", (chunk) => {
      const { type } = JSON.parse(chunk.toString("utf8")) as DaemonRequest;
      asked.push(type);
      const answer =
        type === "ping"
          ? {
              ok: true,
              type,
              pid: process.pid,
              worktreeId: repo.worktreeId,
              root: repo.root,
              squealVersion: OLDER,
              phase: "ready",
              startedAt: record.startedAt,
            }
          : type === "step-down"
            ? { ok: true, type, squealVersion: OLDER, steppingDown: true }
            : { ok: true, type };
      socket.end(`${JSON.stringify({ schemaVersion: 1, ...answer })}\n`);
      if (type === "ping") afterPing(asked.filter((a) => a === "ping").length);
    });
  });
  suite.cleanup(() => server.close());
  await new Promise<void>((resolve) => server.listen(staging, resolve));
  return { asked, bind: () => renameSync(staging, repo.socketPath) };
}

function storeOf(repo: FixtureRepo): Store {
  const store = openStore(repo.commonDir);
  if (isStoreOpenFailure(store)) throw new Error("no store");
  suite.cleanup(() => store.close());
  store.worktrees.upsert({
    id: repo.worktreeId as WorktreeId,
    root: repo.root,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  return store;
}

const bounds = { socketMs: 2_000, lockMs: 1_000, leftoversMs: 0 };

describe.runIf(process.platform === "linux")(
  "squeal start's step-down reaches only the short daemon it pinged (row 011-151)",
  SLOW,
  () => {
    it("asks the short daemon at an unchanged socket after its pings, then stops it", async () => {
      const repo = suite.fixture();
      const store = storeOf(repo);
      const short = shortAt(repo, Date.now() - 60_000, "a");
      const daemon = await standIn(repo, short);
      daemon.bind();
      registersShort(store, repo, short);
      const { cli } = spawnLog(suite);
      await startIn(repo, bounds, cli);
      const pings = Array<string>(PINGS_BEFORE_STEP_DOWN).fill("ping");
      expect(daemon.asked.slice(0, PINGS_BEFORE_STEP_DOWN + 2)).toEqual([
        ...pings,
        "step-down",
        "stop",
      ]);
    });

    it("asks nothing of a short successor that binds and registers between its ping and its step-down", async () => {
      const repo = suite.fixture();
      const store = storeOf(repo);
      const short = shortAt(repo, Date.now() - 60_000, "a");
      const next = shortAt(repo, Date.now() - 1_000, "b");
      const successor = await standIn(repo, next);
      const daemon = await standIn(repo, short, (pings) => {
        if (pings !== PINGS_BEFORE_STEP_DOWN) return;
        successor.bind();
        registersShort(store, repo, next);
      });
      daemon.bind();
      registersShort(store, repo, short);
      const { cli, spawns } = spawnLog(suite);
      await startIn(repo, bounds, cli);
      expect(daemon.asked).toEqual(Array<string>(PINGS_BEFORE_STEP_DOWN).fill("ping"));
      expect(successor.asked.filter((type) => type === "step-down" || type === "stop")).toEqual([]);
      expect(spawns().filter((args) => args.includes("--await-lock"))).toEqual([]);
    });
  },
);
