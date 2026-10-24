import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { readHeader } from "../../src/core/delivery/index.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../src/core/store/index.js";
import { runMissingConfig } from "../helpers/baseline.js";
import {
  daemonSuite,
  delay,
  ping,
  readNotes,
  type SpawnedProcess,
  stopProcess,
  waitFor,
  waitReady,
  withStore,
} from "./helpers.js";

/*
 * Task 001-422, hearsay-tools/squeal#1: beside another connection holding
 * the shared store's write lock past the daemon's 5 s busy timeout, an
 * edit's pass threw `database is locked`, the edit waited up to 30 s for the
 * next pass, and each heartbeat held the event loop up to 5 s. Now each
 * write waits a 250 ms slice and is retried: the edit's revision and a
 * heartbeat land within a second of the lock freeing, the socket answers
 * throughout, and one note names the wait.
 *
 * Task 011-122 (`tasks/011-122/notes.md`): the hold starts once the baseline
 * has recorded. A tier recording in it is the pump's case, whose writes keep
 * 5 s: they held the event loop 10 s, the edit's batch came only after the
 * lock freed, and the note named no revision. Both bounds count from when
 * the writer's commit returned, not from when its hold was due to end.
 *
 * Row 011-192 (`tasks/011-192/notes.md`): a heartbeat is stamped before its
 * write waits for the lock, so a retry in its slice when the lock frees
 * writes a stamp from before the free, and the next beat comes a 5 s period
 * later. The heartbeat's bound times its first write after the hold, as
 * SQLite ran it, not its stamp.
 */

const suite = daemonSuite();
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const LONG_WRITER = join(import.meta.dirname, "long-writer.ts");
const HOLD_MS = 12_000;
/** One hold: the next would start long after the test. */
const REST_MS = 600_000;
/** What "within a second" allows: the slice, the backoff's last delay, and a pass's own work. */
const WITHIN_MS = 1_000;
const PING_TIMEOUT_MS = 1_000;

function startWriter(database: string, env: NodeJS.ProcessEnv, epoch: number): SpawnedProcess {
  const child = spawn(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=UNDICI-EHPA",
      "--import",
      TSX,
      LONG_WRITER,
      database,
      String(HOLD_MS),
      String(REST_MS),
      "0",
      "1",
      String(epoch),
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let out = "";
  let err = "";
  child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
    out += chunk;
  });
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
    err += chunk;
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) =>
    child.on("exit", (code, signal) => done({ code, signal })),
  );
  return { child, exited, stdout: () => out, stderr: () => err };
}

/** One heartbeat write: its order, the daemon's stamp, and when SQLite ran it (epoch ms). */
interface Beat {
  readonly seq: number;
  readonly stamp: number;
  readonly written: number;
}

/**
 * Every heartbeat write from now on, logged by a trigger in the store
 * (row 011-192): the order shows which came first, and `written` when it
 * landed, however late the test reads it and whatever stamp it carries.
 */
function heartbeatLog(database: string): { since: (seq: number) => Beat[]; close: () => void } {
  const db = new DatabaseSync(database);
  db.exec("PRAGMA busy_timeout = 10000");
  db.exec("CREATE TABLE busy_edit_beats (seq INTEGER PRIMARY KEY, stamp INTEGER, written INTEGER)");
  db.exec(`CREATE TRIGGER busy_edit_beat AFTER UPDATE OF daemon_heartbeat_at ON worktrees
    BEGIN INSERT INTO busy_edit_beats (stamp, written)
      VALUES (NEW.daemon_heartbeat_at, CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)); END`);
  const since = db.prepare(
    "SELECT seq, stamp, written FROM busy_edit_beats WHERE seq > ? ORDER BY seq",
  );
  return {
    since: (seq) => since.all(seq) as unknown as Beat[],
    close: () => db.close(),
  };
}

describe("an edit while another connection holds the store's write lock (001-422)", () => {
  it(`is stored within ${WITHIN_MS} ms of a ${HOLD_MS} ms hold ending, and the daemon answers throughout`, async () => {
    const repo = suite.fixture({ "squeal.config.json": runMissingConfig() });
    const created = openStore(repo.commonDir);
    if (isStoreOpenFailure(created)) throw new Error(JSON.stringify(created));
    created.close();
    const daemon = suite.daemon(repo);
    await waitReady(repo, daemon, 300_000);
    await waitFor(
      () =>
        withStore(repo, (store) => {
          const { counts } = readHeader(store, repo.worktreeId);
          return counts.current >= 5 && counts.pending === 0;
        }),
      300_000,
      "the baseline recorded",
    );
    const before = withStore(repo, (store) => store.revisions.latest(repo.worktreeId)?.number ?? 0);
    const beats = heartbeatLog(storePaths(repo.commonDir).database);
    suite.cleanup(() => beats.close());

    // Past the writer's start-up; a writer late for its slot only holds it shorter.
    const epoch = Date.now() + 2_000;
    const freeAt = epoch + HOLD_MS;
    const writer = startWriter(storePaths(repo.commonDir).database, repo.env, epoch);
    suite.cleanup(() => writer.child.kill("SIGKILL"));
    await waitFor(() => writer.stdout().includes("holding"), 60_000, "writer");
    // No write lands while the writer holds the lock: a beat logged after this one lands after the free.
    const lastBeforeHold = beats.since(0).at(-1)?.seq ?? 0;

    // The socket, every 100 ms from the hold's start to past its end.
    const unanswered: number[] = [];
    let pinging = true;
    const pings = (async () => {
      while (pinging) {
        const sent = Date.now();
        if ((await ping(repo.socketPath, PING_TIMEOUT_MS)) === null) unanswered.push(sent - epoch);
        await delay(100);
      }
    })();

    await delay(Math.max(0, epoch + 1_000 - Date.now()));
    writeFileSync(
      join(repo.root, "src/math.ts"),
      "export const add = (a: number, b: number) => b + a;\n",
    );
    // Past the backoff's first steps: the daemon is retrying while the lock stays held.
    await delay(Math.max(0, freeAt - Date.now()));

    const stored = await waitFor(
      () =>
        withStore(repo, (store) => {
          const latest = store.revisions.latest(repo.worktreeId);
          return latest !== null && latest.number > before ? latest : null;
        }),
      30_000,
      "the edit's revision",
    );
    const freed = await waitFor(
      () => Number(/^freed (\d+)$/m.exec(writer.stdout())?.[1] ?? 0) || null,
      30_000,
      "the writer's commit",
    );
    const heartbeat = await waitFor(
      () => beats.since(lastBeforeHold)[0] ?? null,
      30_000,
      "a heartbeat after the hold",
    );
    // A miss names its phase: the writer's own lateness, or the daemon's time after the lock freed.
    const timing = `lock due free at ${freeAt}, freed at ${freed}; notes: ${JSON.stringify(readNotes(repo))}`;
    expect(stored.createdAt - freed, `the revision, ${timing}`).toBeLessThanOrEqual(WITHIN_MS);
    const written = `beats after the hold: ${JSON.stringify(beats.since(lastBeforeHold))}`;
    expect(heartbeat.written - freed, `the heartbeat, ${timing}; ${written}`).toBeLessThanOrEqual(
      WITHIN_MS,
    );
    const busy = await waitFor(
      () => {
        const found = readNotes(repo).filter((note) => note.startsWith("the store was busy"));
        return found.length > 0 ? found : null;
      },
      30_000,
      "the busy note",
    );
    await delay(1_000);
    pinging = false;
    await pings;

    expect(unanswered).toEqual([]);
    const notes = readNotes(repo);
    expect(notes.filter((note) => note.startsWith("the store was busy"))).toEqual(busy);
    expect(busy).toHaveLength(1);
    expect(busy[0]).toMatch(
      new RegExp(`^the store was busy for [\\d.]+ s .*revision ${stored.number}\\b`),
    );
    expect(notes.filter((note) => /database is locked/.test(note))).toEqual([]);
    await stopProcess(writer);
    expect(writer.stderr()).toBe("");
  }, 600_000);
});
