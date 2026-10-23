import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isStoreOpenFailure, openStore, storePaths } from "../../src/core/store/index.js";
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
 * Row 011-126 (`tasks/011-122/notes.md`, "With a tier in the hold"): a tier
 * that recorded while another connection held the store's write lock waited
 * the pump's 5 s busy timeout, then its requeue's commit and the next
 * selection's lookup waited again. The daemon's event loop was held up to
 * 10 s: no timer ran, an edit's batch came only after the lock freed, and
 * the tier's files ran again. Now the pump's writes wait a 250 ms slice, and
 * the record keeps the run's results until it lands. Pings go to the front
 * desk's thread, so the event loop is read by `stall-preload.mjs`.
 */

const suite = daemonSuite();
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const LONG_WRITER = join(import.meta.dirname, "long-writer.ts");
const STALL_PRELOAD = pathToFileURL(join(import.meta.dirname, "stall-preload.mjs")).href;
const HOLD_MS = 12_000;
/** One hold: the next would start long after the test. */
const REST_MS = 600_000;
/** The slow test file ends this long into the hold, so its tier records while the lock is held. */
const INTO_HOLD_MS = 2_000;
/** C7: "every ping is answered within 1 s", and no hold of the event loop as long. */
const STALL_MS = 1_000;
const PING_TIMEOUT_MS = 1_000;
/** What "within a second" allows an edit's revision after the lock frees (`busy-edit.test.ts`). */
const WITHIN_MS = 1_000;

/** A test file that logs each run to `runs`, then waits for `release` and ends `INTO_HOLD_MS` later. */
function slowTest(runs: string, release: string): string {
  return [
    'import { appendFileSync, existsSync } from "node:fs";',
    'import { setTimeout as sleep } from "node:timers/promises";',
    'import { test } from "vitest";',
    "",
    'test("slow", async () => {',
    `  appendFileSync(${JSON.stringify(runs)}, "run\\n");`,
    `  while (!existsSync(${JSON.stringify(release)})) await sleep(50);`,
    `  await sleep(${INTO_HOLD_MS});`,
    "}, 120_000);",
    "",
  ].join("\n");
}

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
    // The daemon's preload stays out of the writer.
    { env: { ...env, NODE_OPTIONS: "" }, stdio: ["ignore", "pipe", "pipe"] },
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

/** The holds of the daemon's event loop `stall-preload.mjs` logged. */
function readStalls(log: string): { start: number; ms: number }[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [start, ms] = line.split(" ").map(Number);
      return { start: start ?? 0, ms: ms ?? 0 };
    });
}

describe("a tier that records while another connection holds the store's write lock (011-126)", () => {
  it(`holds the daemon's event loop under ${STALL_MS} ms through a ${HOLD_MS} ms hold, and stores the tier's results after it, running its files once`, async () => {
    const scratch = mkdtempSync(join(tmpdir(), "sq-126-"));
    suite.cleanup(() => rmSync(scratch, { recursive: true, force: true }));
    const runs = join(scratch, "slow-runs.log");
    const release = join(scratch, "release");
    const stallLog = join(scratch, "stalls.log");
    const repo = suite.fixture({ "test/slow.test.ts": slowTest(runs, release) });
    repo.env.NODE_OPTIONS = `--import=${STALL_PRELOAD}`;
    repo.env.SQUEAL_TEST_STALLS = stallLog;
    const created = openStore(repo.commonDir);
    if (isStoreOpenFailure(created)) throw new Error(JSON.stringify(created));
    created.close();
    const daemon = suite.daemon(repo);
    await waitReady(repo, daemon, 300_000);
    // The baseline's tier with the slow file runs, and waits for the hold.
    await waitFor(() => existsSync(runs), 300_000, "the slow test file's run");

    // Past the writer's start-up; a writer late for its slot only holds it shorter.
    const epoch = Date.now() + 2_000;
    const writer = startWriter(storePaths(repo.commonDir).database, repo.env, epoch);
    suite.cleanup(() => writer.child.kill("SIGKILL"));
    await waitFor(() => writer.stdout().includes("holding"), 60_000, "writer");
    writeFileSync(release, "");
    const before = withStore(repo, (store) => store.revisions.latest(repo.worktreeId)?.number ?? 0);

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

    // An edit once the tier's record has met the held lock: its pass is retried beside it.
    await delay(Math.max(0, epoch + INTO_HOLD_MS + 2_000 - Date.now()));
    writeFileSync(
      join(repo.root, "src/math.ts"),
      "export const add = (a: number, b: number) => b + a;\n",
    );

    const freed = await waitFor(
      () => Number(/^freed (\d+)$/m.exec(writer.stdout())?.[1] ?? 0) || null,
      60_000,
      "the writer's commit",
    );
    const stored = await waitFor(
      () =>
        withStore(repo, (store) => {
          const latest = store.revisions.latest(repo.worktreeId);
          return latest !== null && latest.number > before ? latest : null;
        }),
      30_000,
      "the edit's revision",
    );
    const slow = await waitFor(
      () =>
        withStore(
          repo,
          (store) =>
            store.knownStates
              .list(repo.worktreeId)
              .find(
                ({ check }) => check.kind === "test" && check.testPath === "test/slow.test.ts",
              ) ?? null,
        ),
      30_000,
      "the slow test file's result",
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

    // From the hold's start to 2 s past the free; the daemon's start-up is not this test's.
    const stalls = readStalls(stallLog).filter(
      ({ start, ms }) => start + ms > epoch && start < freed + 2_000,
    );
    expect(existsSync(stallLog), "the stall monitor ran in the daemon").toBe(true);
    const seen = `hold from ${epoch}, freed at ${freed}; stalls ${JSON.stringify(stalls)}; notes ${JSON.stringify(readNotes(repo))}`;
    expect(
      stalls.filter(({ ms }) => ms >= STALL_MS),
      seen,
    ).toEqual([]);
    expect(unanswered, seen).toEqual([]);
    // The tier's run is the one stored: its files did not run again.
    expect(slow.outcome, seen).toBe("pass");
    expect(readFileSync(runs, "utf8").split("\n").filter(Boolean), seen).toHaveLength(1);
    expect(stored.createdAt - freed, seen).toBeLessThanOrEqual(WITHIN_MS);
    expect(busy, seen).toHaveLength(1);
    expect(busy[0], seen).toMatch(
      new RegExp(
        `^the store was busy for [\\d.]+ s .*(the results of \\d+ files.*revision ${stored.number}\\b|revision ${stored.number}\\b.*the results of \\d+ files)`,
      ),
    );
    expect(readNotes(repo).filter((note) => /database is locked/.test(note))).toEqual([]);
    await stopProcess(writer);
    expect(writer.stderr()).toBe("");
  }, 600_000);
});
