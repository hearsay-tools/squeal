import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { startCommand } from "../../src/cli/start.js";
import { STOP_BOUNDS, stopCommand } from "../../src/cli/stop.js";
import { clearStoppedMark } from "../../src/cli/stopped-mark.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { squealVersion } from "../../src/core/daemon/version.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { markStopped } from "../../src/core/presence/events.js";
import { readStopFile } from "../../src/core/presence/marks.js";
import { stoppedMetaKey } from "../../src/core/presence/stored.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { lockFileFor, storePaths } from "../../src/core/store/paths.js";
import type { AbsolutePath, EpochMs } from "../../src/core/types/common.js";
import type { Store } from "../../src/core/types/store.js";
import { git } from "../hash/git-repo.js";
import { holdLock, type LockHolder } from "../status/hold-lock.js";
import { busyClause, line } from "./busy-lines.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";

/*
 * Spec 021 D1 (row 021-07, #158, #108): `squeal start` asks a store another
 * process holds again until its bound while a legacy `meta` stop mark is there
 * (row 021-39: `squeal stop` writes none).
 * Within it each writes its mark and succeeds; past it each exits 1 with the
 * busy text naming the lock's holder (`describeHolders`), and `start` starts
 * nothing. Where `lockHolders` has no source yet (row 021-10's stub, or not
 * Linux), the holder below stands in for it with the pid that holds.
 */

const named = vi.hoisted(() => ({ pid: 0 }));
vi.mock("../../src/core/store/lock-holders.js", async (original) => {
  const real = await original<typeof import("../../src/core/store/lock-holders.js")>();
  const stand = () => [{ pid: named.pid, command: "the test's lock holder", waiting: false }];
  return { ...real, lockHolders: (database: string) => real.lockHolders(database) ?? stand() };
});

const saved = { ...process.env };
let dir: string;
const stores: Store[] = [];
const holders: LockHolder[] = [];

beforeEach(() => {
  dir = realpathSync(mkdtempSync("/tmp/sq-"));
  // Its own runtime dir, so no daemon of this host answers; a daemon `start` spawned would fail.
  process.env.XDG_RUNTIME_DIR = dir;
  process.env.SQUEAL_CLI = join(dir, "no-such-cli.mjs");
});

afterEach(async () => {
  for (const holder of holders.splice(0)) {
    holder.child.kill();
    await holder.released;
  }
  for (const store of stores.splice(0)) store.close();
  closeFakeDaemons();
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...saved };
});

/** A checkout with a store, stopped until `squeal start` by a legacy `meta` mark when `stopped`. */
function checkout(stopped = false) {
  const root = join(dir, "repo") as AbsolutePath;
  mkdirSync(root);
  git(root, ["init", "-q"]);
  writeFileSync(join(root, "a.txt"), "a\n");
  git(root, ["add", "a.txt"]);
  git(root, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "a"]);
  const commonDir = join(root, ".git") as AbsolutePath;
  const store = openStore(commonDir);
  if (isStoreOpenFailure(store)) throw new Error("no store");
  stores.push(store);
  const id = worktreeIdFor(root);
  if (stopped) store.transaction(() => markStopped(store, id, 1 as EpochMs, null, true));
  const mark = () => store.meta.get(stoppedMetaKey(id));
  return { root, database: storePaths(commonDir).database, mark };
}

/** A second process that holds the store's write lock for `holdMs`. */
async function holding(database: string, holdMs: number): Promise<LockHolder> {
  const holder = await holdLock(database, "immediate", holdMs);
  holders.push(holder);
  named.pid = holder.child.pid ?? 0;
  return holder;
}

async function cli(command: typeof stopCommand, argv: string[], cwd: string, busyMs?: number) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    env: {},
  };
  const started = Date.now();
  const code = await command(argv, io, STOP_BOUNDS, busyMs);
  return { code, stdout, stderr, tookMs: Date.now() - started };
}

/** A stand-in daemon at the worktree's socket, which answers `ping` in `phase`. */
function daemonAt(
  root: AbsolutePath,
  phase: "ready" | "stopping",
  onRequest?: (type: string) => void,
) {
  const ping = {
    ok: true,
    type: "ping",
    pid: process.pid,
    worktreeId: worktreeIdFor(root),
    root,
    squealVersion: squealVersion(),
    phase,
    startedAt: 1,
  };
  return fakeDaemon(socketPathFor(worktreeIdFor(root)), { ping: [ping] }, onRequest);
}

/** A linked worktree of `root`, with no daemon and no `worktrees` row: an idle worker's. */
function linked(root: AbsolutePath): AbsolutePath {
  const tree = join(dir, "linked") as AbsolutePath;
  git(root, ["worktree", "add", "-q", tree]);
  return tree;
}

/** The stop mark beside the lock file of the worktree at `root` (row 021-39). */
const fileMark = (root: AbsolutePath, commonDir: AbsolutePath) =>
  readStopFile(lockFileFor(commonDir, worktreeIdFor(root)));

/** The `meta` rows of stop marks in the store at `database`, read without a lock. */
function stopRows(database: string): string[] {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const rows = db.prepare("SELECT key FROM meta WHERE key LIKE 'daemon-stopped:%'").all();
    return rows.map((row) => String(row.key));
  } finally {
    db.close();
  }
}

/*
 * Row 021-39 (#285): the stop mark is a file beside the worktree's lock file,
 * so a store another process holds neither delays `squeal stop` nor drops its
 * mark, in an idle linked worktree beside the shared store above all.
 */
describe("`squeal stop` beside a store another process holds (row 021-39, #285)", {
  timeout: 30_000,
}, () => {
  for (const argv of [[], ["--until-start"]]) {
    it(`${argv.length === 0 ? "plain" : "--until-start"}: records the stop fast in an idle linked worktree`, async () => {
      const { root, database } = checkout();
      writeFileSync(join(root, "squeal.config.json"), "{}\n");
      const tree = linked(root);
      await holding(database, 30_000);

      const out = await cli(stopCommand, argv, tree);

      expect(out).toMatchObject({ code: 0, stderr: "" });
      expect(out.tookMs).toBeLessThan(2_000);
      const until = argv.length === 0 ? {} : { untilStart: true };
      expect(fileMark(tree, join(root, ".git") as AbsolutePath)).toEqual({
        at: expect.any(Number),
        tree: expect.any(String),
        ...until,
      });
      expect(stopRows(database)).toEqual([]);
    });
  }

  it("keeps a legacy `untilStart` mark through a plain stop, read without a write lock", async () => {
    const { root, database } = checkout(true);
    await holding(database, 30_000);

    const out = await cli(stopCommand, [], root);

    expect(out).toMatchObject({ code: 0, stderr: "" });
    expect(out.tookMs).toBeLessThan(2_000);
    expect(fileMark(root, join(root, ".git") as AbsolutePath)).toMatchObject({ untilStart: true });
  });
});

describe("`squeal start` beside a store another process holds (spec 021 D1, #108)", {
  timeout: 30_000,
}, () => {
  it("clears the mark when the lock is freed within the bound, past one busy timeout", async () => {
    const { root, database, mark } = checkout(true);
    const seen = await daemonAt(root, "ready");
    await holding(database, 2_500);

    const out = await cli(startCommand, [], root);

    expect(out.stderr).toBe("");
    expect(out).toMatchObject({ code: 0 });
    expect(out.stdout).toMatch(/^Squeal daemon (alive|answered) for /);
    expect(out.tookMs).toBeGreaterThanOrEqual(2_000);
    expect(mark()).toBeNull();
    expect(seen).toContain("resume");
  });

  it("exits 1 past the bound with the mark still there, names the holder and starts nothing", async () => {
    const { root, database, mark } = checkout(true);
    const seen = await daemonAt(root, "ready");
    const holder = await holding(database, 30_000);

    const out = await cli(startCommand, [], root, 400);

    expect(out).toMatchObject({ code: 1, stdout: "" });
    expect(out.stderr).toMatch(
      line(
        `squeal: could not clear the stop mark: ${busyClause(holder.child.pid)}; ` +
          "nothing started: run `squeal start` again",
      ),
    );
    expect(JSON.parse(mark() ?? "null")).toMatchObject({ untilStart: true });
    expect(seen).toEqual([]);
  });

  it("clears a file-backed mark fast, with no store write (row 021-39)", async () => {
    const { root, database } = checkout();
    const commonDir = join(root, ".git") as AbsolutePath;
    const tree = linked(root);
    expect((await cli(stopCommand, ["--until-start"], tree)).code).toBe(0);
    expect(fileMark(tree, commonDir)).not.toBeNull();
    await holding(database, 30_000);

    const started = Date.now();
    expect(await clearStoppedMark(tree, 400)).toBeNull();

    expect(Date.now() - started).toBeLessThan(400);
    expect(fileMark(tree, commonDir)).toBeNull();
  });

  it("clears both the file and the legacy row of a stop made over a legacy mark (row 021-39)", async () => {
    const { root, database, mark } = checkout(true);
    const commonDir = join(root, ".git") as AbsolutePath;
    expect((await cli(stopCommand, [], root)).code).toBe(0);
    expect(fileMark(root, commonDir)).toMatchObject({ untilStart: true });
    expect(mark()).not.toBeNull();

    expect(await clearStoppedMark(root)).toBeNull();

    expect(fileMark(root, commonDir)).toBeNull();
    expect(mark()).toBeNull();
    expect(stopRows(database)).toEqual([]);
  });

  it("exits 1 when the handoff claim is busy past the bound, and spawns no successor", async () => {
    const { root, database } = checkout();
    // Taken in this process once the mark is cleared, at the first ping; freed after `start` ends.
    const lock = new DatabaseSync(database);
    named.pid = process.pid;
    const take = (type: string) => {
      if (type === "ping" && !lock.isTransaction) lock.exec("BEGIN IMMEDIATE");
    };
    const seen = await daemonAt(root, "stopping", take);

    try {
      const out = await cli(startCommand, [], root, 300);

      expect(out).toMatchObject({ code: 1, stdout: "" });
      expect(out.stderr).toMatch(
        line(
          `squeal: could not claim the handoff from the stopping daemon for ${root}: ` +
            `${busyClause(process.pid)}; no daemon started: run \`squeal start\` again`,
        ),
      );
    } finally {
      lock.exec("ROLLBACK");
      lock.close();
    }
    expect(seen).toContain("stop");
  });
});
