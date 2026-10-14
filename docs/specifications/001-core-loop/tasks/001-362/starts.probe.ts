/*
 * Task 001-362 probe: real daemon starts beside `long-writer.ts` writers, as
 * `test/daemon/busy-store.test.ts`, with the holds, rests, writers and starts
 * from the environment (`PROBE_HOLD_MS`, `PROBE_REST_MS`, `PROBE_WRITERS`,
 * `PROBE_STARTS`), and with `PROBE_POLL_MS` `poll-writer.ts` retrying that often. Every start that exits instead of serving prints its
 * stderr; the counts print at the end.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { isStoreOpenFailure, openStore, storePaths } from "../../../../../src/core/store/index.js";
import {
  daemonSuite,
  ping,
  type SpawnedProcess,
  stopProcess,
  waitFor,
} from "../../../../../test/daemon/helpers.js";

const suite = daemonSuite();
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const POLL = process.env.PROBE_POLL_MS;
const LONG_WRITER =
  POLL === undefined
    ? join(import.meta.dirname, "../../../../../test/daemon/long-writer.ts")
    : join(import.meta.dirname, "poll-writer.ts");
const HOLD = process.env.PROBE_HOLD_MS ?? "7000";
const REST = process.env.PROBE_REST_MS ?? "1000";
const WRITERS = Number(process.env.PROBE_WRITERS ?? "2");
const STARTS = Number(process.env.PROBE_STARTS ?? "3");

function writer(database: string, env: NodeJS.ProcessEnv): SpawnedProcess {
  const child = spawn(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--import",
      TSX,
      LONG_WRITER,
      database,
      HOLD,
      REST,
      ...(POLL === undefined ? [] : [POLL]),
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let out = "";
  child.stdout?.setEncoding("utf8").on("data", (c: string) => {
    out += c;
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) =>
    child.on("exit", (code, signal) => done({ code, signal })),
  );
  return { child, exited, stdout: () => out, stderr: () => "" };
}

it("probe", async () => {
  const repo = suite.fixture();
  const created = openStore(repo.commonDir);
  if (isStoreOpenFailure(created)) throw new Error(JSON.stringify(created));
  created.close();
  const database = storePaths(repo.commonDir).database;
  const writers = Array.from({ length: WRITERS }, () => writer(database, repo.env));
  suite.cleanup(() => {
    for (const w of writers) w.child.kill("SIGKILL");
  });
  await waitFor(() => writers.some((w) => w.stdout().includes("holding")), 60_000, "writers");
  let failed = 0;
  for (let start = 1; start <= STARTS; start++) {
    const began = Date.now();
    const daemon = suite.daemon(repo);
    // A start that gave up still writes its notes at the start's busy timeout before it exits.
    const outcome = await waitFor(
      async () => {
        if (daemon.child.exitCode !== null) return "exited";
        const answer = await ping(repo.socketPath, 500);
        return answer?.phase === "ready" ? "ready" : null;
      },
      900_000,
      "ready or exit",
    ).catch(() => "neither");
    if (outcome !== "ready") {
      failed++;
      console.log(`start ${start}: ${outcome} after ${Date.now() - began} ms:\n${daemon.stderr()}`);
    }
    await stopProcess(daemon);
  }
  console.log(`hold ${HOLD} rest ${REST} poll ${POLL ?? 250} writers ${WRITERS}: ${failed} of ${STARTS} starts failed`);
  expect(failed).toBe(0);
}, 3_600_000);
