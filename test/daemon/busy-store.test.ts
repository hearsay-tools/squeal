import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isStoreOpenFailure, openStore, storePaths } from "../../src/core/store/index.js";
import {
  daemonSuite,
  readNotes,
  type SpawnedProcess,
  stopProcess,
  waitFor,
  waitReady,
} from "./helpers.js";

/*
 * Task 001-161, 004 lessons defect 9: a daemon starting on cezar's shared
 * store exited with "daemon exited: could not start: database is locked",
 * 5.03 s after another worktree's daemon began recording a 4,165-result tier
 * in one write transaction. The daemon's busy timeout is 5 s. The ledger now
 * writes a tier in well under a second, but a start must survive a long
 * writer anyway: here two writers stand in for the busy daemons, each
 * holding the write lock 7 s at a time, and a daemon starts beside them
 * three times in a row.
 */

const suite = daemonSuite();
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const LONG_WRITER = join(import.meta.dirname, "long-writer.ts");
const HOLD_MS = 7_000;
const REST_MS = 1_000;
const STARTS = 3;
const LOCKED = /database is locked|store busy/;
/** A start that failed; after ready the daemon's 5 s busy timeout is not this test's subject. */
const START_FAILED = /could not start/;

function startWriter(database: string, env: NodeJS.ProcessEnv): SpawnedProcess {
  const child = spawn(
    process.execPath,
    [
      // Node 22 warns about SQLite and undici's proxy agent; the test asserts a silent writer.
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=UNDICI-EHPA",
      "--import",
      TSX,
      LONG_WRITER,
      database,
      String(HOLD_MS),
      String(REST_MS),
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

describe("a daemon starting beside long writers on the shared store (task 001-161)", () => {
  it(`starts every time, ${STARTS} starts in a row, while two writers hold the lock ${HOLD_MS} ms at a time`, async () => {
    const repo = suite.fixture();
    const created = openStore(repo.commonDir);
    if (isStoreOpenFailure(created)) throw new Error(JSON.stringify(created));
    created.close();

    const database = storePaths(repo.commonDir).database;
    const writers = [startWriter(database, repo.env), startWriter(database, repo.env)];
    suite.cleanup(() => {
      for (const writer of writers) writer.child.kill("SIGKILL");
    });
    await waitFor(() => writers.every((w) => w.stdout().includes("holding")), 60_000, "writers");

    for (let start = 1; start <= STARTS; start++) {
      const daemon = suite.daemon(repo);
      await waitReady(repo, daemon, 300_000);
      expect(daemon.stderr(), `start ${start}`).not.toMatch(LOCKED);
      await stopProcess(daemon);
    }

    expect(readNotes(repo).filter((note) => START_FAILED.test(note))).toEqual([]);
    for (const writer of writers) await stopProcess(writer);
    expect(writers.map((w) => w.stderr())).toEqual(["", ""]);
  }, 1_200_000);
});
