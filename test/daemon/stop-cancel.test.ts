import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { findHarnessProcess } from "../../src/harness/shared/harness-process.js";
import { CANCELLED, cancelled } from "../../src/runners/vitest/run.js";
import { recorded } from "../harness/helpers.js";
import { runMissingConfig } from "../helpers/baseline.js";
import {
  daemonSuite,
  delay,
  diagnose,
  type FixtureRepo,
  ping,
  readNotes,
  SLOW,
  type SpawnedProcess,
  spawnCli,
  waitFor,
} from "./helpers.js";

/*
 * Task 001-367 (hearsay-tools/squeal#2), D10 as amended 2026-10-16: `squeal
 * stop` cancels the tiers in flight in every lane, stops the processes the
 * daemon started and starts no further tier, the departure's slow drain
 * included. It returns once none of them holds the worktree.
 */

const suite = daemonSuite();

/** Under a loaded host: Vitest's cancel forces its workers after 1 s, the shutdown follows. */
const STOP_WITHIN_MS = 15_000;

/**
 * A test that starts a child holding the root as cwd and a file in it open,
 * then sleeps. It renames the child's pid into `started`: a write creates
 * the file empty before it writes, and a poll between the two read pid 0
 * (row 011-188). The child ends by itself past the test's timeout: a daemon
 * killed mid-tier, as a failed case's teardown kills it after 60 s, stops
 * nothing its tier left.
 */
function holdingTest(dir: string): string {
  const at = (name: string) => JSON.stringify(join(dir, name));
  return `import { spawn } from "node:child_process";
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
it("holds the root with a child until the flag", async () => {
  const root = join(import.meta.dirname, "..");
  const child = spawn(
    process.execPath,
    ["-e", "require('node:fs').openSync('package.json', 'r'); setTimeout(() => {}, 200_000)"],
    { cwd: root, stdio: "ignore" },
  );
  await new Promise((done) => child.once("spawn", done));
  writeFileSync(${at("started.tmp")}, String(child.pid));
  renameSync(${at("started.tmp")}, ${at("started")});
  const deadline = Date.now() + 150_000;
  while (!existsSync(${at("flag")}) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
  }
  expect(existsSync(${at("flag")})).toBe(true);
}, 170_000);
`;
}

/** A test that appends to `started-<name>` and sleeps until `release-<name>` exists. */
function heldTest(dir: string, name: string): string {
  const at = (file: string) => JSON.stringify(join(dir, `${file}-${name}`));
  return `import { appendFileSync, existsSync } from "node:fs";
import { expect, it } from "vitest";
it("holds until released", async () => {
  appendFileSync(${at("started")}, "x");
  const deadline = Date.now() + 150_000;
  while (!existsSync(${at("release")}) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
  }
  expect(existsSync(${at("release")})).toBe(true);
}, 170_000);
`;
}

/** Every process other than this one with its cwd or an open file at or under `root`. */
function holders(root: string): string[] {
  const under = (path: string) => path === root || path.startsWith(`${root}/`);
  const found: string[] = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    const links = [`/proc/${name}/cwd`];
    try {
      for (const fd of readdirSync(`/proc/${name}/fd`)) links.push(`/proc/${name}/fd/${fd}`);
    } catch {
      // Gone, or another user's.
    }
    for (const link of links) {
      let target: string;
      try {
        target = readlinkSync(link);
      } catch {
        continue;
      }
      if (under(target)) found.push(`${link} -> ${target} (${commandOf(name)})`);
    }
  }
  return found;
}

function commandOf(pid: string): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").trim();
  } catch {
    return "";
  }
}

/** The failures of this repository's cancelled Vitest runs, from each run's `report.json` (row 011-56). */
function vitestCancels(repo: Pick<FixtureRepo, "commonDir">): string[] {
  const runs = storePaths(repo.commonDir).runsDir;
  return readdirSync(runs).flatMap((id) => {
    if (!existsSync(join(runs, id, "vitest.log"))) return [];
    const { report } = JSON.parse(readFileSync(join(runs, id, "report.json"), "utf8")) as {
      report: { failure: string | null };
    };
    return report.failure?.startsWith(CANCELLED) === true ? [report.failure] : [];
  });
}

async function stopDaemon(repo: FixtureRepo) {
  const started = performance.now();
  const stop = spawnCli(suite.cli, ["stop", repo.root], { cwd: "/", env: repo.env });
  const exit = await stop.exited;
  return { exit, stdout: stop.stdout(), stderr: stop.stderr(), ms: performance.now() - started };
}

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function waitOr(
  spawned: SpawnedProcess | null,
  repo: FixtureRepo,
  check: () => boolean,
  what: string,
) {
  await waitFor(() => check() || null, 150_000, what).catch((error: Error) => {
    throw new Error(`${error.message}\n${spawned === null ? "" : diagnose(repo, spawned)}`);
  });
}

describe.runIf(process.platform === "linux")(
  "squeal stop cancels the tier in flight (task 001-367)",
  SLOW,
  () => {
    it("returns within seconds mid-batch, and nothing of Squeal's holds the root afterwards", async () => {
      const dir = scratch("sq-001-367-");
      const repo = suite.fixture({
        "test/hold.test.ts": holdingTest(dir),
        "squeal.config.json": runMissingConfig(),
      });
      // Detached, as a hook's spawn: the daemon leads its own process group.
      const start = spawnCli(suite.cli, ["start", repo.root], { cwd: "/", env: repo.env });
      expect(await start.exited).toEqual({ code: 0, signal: null });
      await waitOr(null, repo, () => existsSync(join(dir, "started")), "the holding test started");
      const child = Number(readFileSync(join(dir, "started"), "utf8"));
      expect(existsSync(`/proc/${child}`)).toBe(true);

      const stopped = await stopDaemon(repo);
      console.log(`001-367: squeal stop mid-batch returned in ${Math.round(stopped.ms)} ms`);
      expect(stopped.exit).toEqual({ code: 0, signal: null });
      expect(stopped.stdout).toBe(`Squeal daemon stopped for ${repo.root}\n`);
      expect(stopped.ms).toBeLessThan(STOP_WITHIN_MS);
      expect(await ping(repo.socketPath, 500)).toBeNull();
      expect(existsSync(`/proc/${child}`)).toBe(false);
      expect(holders(repo.root)).toEqual([]);
      // The shutdown's note names the stop, and so does the cancelled run (row 011-56).
      expect(readNotes(repo).some((note) => note.startsWith("daemon stopped: squeal stop"))).toBe(
        true,
      );
      expect(vitestCancels(repo)).toEqual([cancelled("stop")]);
    });

    it("starts no slow file once a stop during the departure drain is accepted", async () => {
      const dir = scratch("sq-001-367-drain-");
      const names = ["a", "b"] as const;
      const files: Record<string, string> = {
        "squeal.config.json": runMissingConfig(
          JSON.stringify({
            slow: { include: ["test/slow-*.test.ts"], maxParallel: 1, maxLoadPerCpu: 1000 },
          }),
        ),
      };
      for (const name of names) files[`test/slow-${name}.test.ts`] = heldTest(dir, name);
      const repo = suite.fixture(files);
      // The pool's size pinned, not the host's CPUs − 1 (001 D11).
      const userConfig = join(repo.runtimeDir, "config", "squeal");
      mkdirSync(userConfig, { recursive: true });
      writeFileSync(
        join(userConfig, "config.json"),
        `${JSON.stringify({ capacity: { hostSlots: 16 } })}\n`,
      );
      suite.cleanup(() => {
        for (const name of names) writeFileSync(join(dir, `release-${name}`), "");
      });
      const starts = (name: string) => {
        const path = join(dir, `started-${name}`);
        return existsSync(path) ? readFileSync(path, "utf8").length : 0;
      };
      const spawned = suite.daemon(repo);
      await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
      await hook(repo, "session-start", { source: "startup" });
      await waitOr(spawned, repo, () => starts("a") + starts("b") > 0, "a slow file started");
      const first = starts("a") > 0 ? "a" : "b";
      const second = first === "a" ? "b" : "a";
      await hook(repo, "session-end", {});
      await waitOr(
        spawned,
        repo,
        () =>
          readNotes(repo).some((note) =>
            note.startsWith("the last session ended with slow files pending"),
          ),
        "the departure drain",
      );

      const stopped = await stopDaemon(repo);
      expect(stopped.exit).toEqual({ code: 0, signal: null });
      expect(stopped.ms).toBeLessThan(STOP_WITHIN_MS);
      expect(await Promise.race([spawned.exited, delay(5_000).then(() => null)])).not.toBeNull();
      await delay(2_000);
      expect(starts(second)).toBe(0);
      expect(starts(first)).toBe(1);
    });
  },
);

async function hook(
  repo: FixtureRepo,
  event: "session-start" | "session-end",
  extra: Record<string, unknown>,
) {
  const payload = recorded(event, repo.root, { session_id: "s1", ...extra });
  await runHook(event, payload, {
    env: repo.env,
    ensureDaemon: async () => "alive",
    harnessProcess: () => findHarnessProcess({ ppid: process.pid }),
  });
}
