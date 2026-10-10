import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  daemonSuite,
  type FixtureRepo,
  ping,
  readNotes,
  SLOW,
  spawnCli,
  waitFor,
  waitReady,
  withStore,
} from "./helpers.js";
import { resultOf } from "./scratch-helpers.js";
import { isAlive } from "./strays.js";

/*
 * Spec 001 D12 as amended for lessons 003, defect 8 (task 001-142): what a
 * test leaves running is stopped when its tier ends, and what the daemon's
 * own process tree holds when it exits. The daemon is spawned as hooks spawn
 * it (detached, `ensureDaemon`), so it leads its process group; not through
 * `squeal start`, whose wait for the answer a loaded host outlasts.
 */

/**
 * A test that leaves a detached sleeper and an orphan in the daemon's group,
 * the orphan deaf to SIGTERM, and waits for a child of its own.
 */
function escapingTest(pidFile: string): string {
  return `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
const sleeper = ["-e", "setTimeout(() => {}, 600000)"];
const deaf = ["-e", "process.on('SIGTERM', () => {}); setTimeout(() => {}, 600000)"];
it("leaves two sleepers behind", async () => {
  const detached = spawn(process.execPath, sleeper, { detached: true, stdio: "ignore" });
  detached.unref();
  // No env of the worker's: only its process group says whose it is.
  const plain = spawn(process.execPath, deaf, { stdio: "ignore", env: { PATH: process.env.PATH } });
  plain.unref();
  const own = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(3), 1500)"], { stdio: "ignore" });
  expect(await new Promise((done) => own.on("exit", done))).toBe(3);
  process.kill(detached.pid, 0);
  process.kill(plain.pid, 0);
  writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([detached.pid, plain.pid]));
});
`;
}

/** A global setup whose child, started in the daemon itself, its teardown forgets. */
function forgetfulSetup(pidFile: string): string {
  return `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
export default function setup() {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600000)"], { stdio: "ignore" });
  child.unref();
  writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([child.pid]));
}
`;
}

/**
 * Leads a shell pipeline's process group with `cat` in it, leaves a
 * grandchild orphaned there, and prints what the tier's stop found.
 */
function pipelineLeader(escaped: string): string {
  return `const { spawn } = require("node:child_process");
import(${JSON.stringify(escaped)}).then(async ({ EscapedChildren }) => {
  const children = new EscapedChildren();
  const since = children.mark();
  const leaves = "require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: 'ignore' }).unref()";
  const parent = spawn(process.execPath, ["-e", leaves], { stdio: "ignore" });
  await new Promise((done) => parent.on("exit", done));
  console.log(await children.afterRun("", since, since));
});
`;
}

const SETUP_CONFIG = `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], testTimeout: 60_000, globalSetup: ["./setup.ts"] },
});
`;

describe.runIf(process.platform === "linux")(
  "squeal daemon: what tests leave running (spec 001 D12)",
  SLOW,
  () => {
    const suite = daemonSuite();

    function pidDir(): string {
      const dir = mkdtempSync(join(tmpdir(), "sq-142-"));
      suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
      return dir;
    }

    /** Spawned detached, as `ensureDaemon` spawns it; the suite stops it by its root. */
    async function start(repo: FixtureRepo): Promise<void> {
      const child = spawn(process.execPath, [suite.cli, "daemon", repo.root], {
        cwd: "/",
        env: repo.env,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      await waitReady(repo);
    }

    /** The pids the fixture wrote, stopped after the test whatever it found. */
    function pids(file: string): number[] {
      const found = JSON.parse(readFileSync(file, "utf8")) as number[];
      suite.cleanup(() => {
        for (const pid of found) if (isAlive(pid)) process.kill(pid, "SIGKILL");
      });
      return found;
    }

    it("stops a test's detached sleeper and its orphan when the tier ends, not its own child", async () => {
      const pidFile = join(pidDir(), "pids.json");
      const repo = suite.fixture({ "test/escape.test.ts": escapingTest(pidFile) });
      await start(repo);
      const result = await resultOf(repo, undefined, "test/escape.test.ts");
      expect(result.outcome).toBe("pass");
      const [detached, plain] = pids(pidFile);
      await waitFor(
        () => [detached, plain].every((pid) => pid !== undefined && !isAlive(pid)),
        10_000,
        "both sleepers gone after the tier",
      );
      const note = readNotes(repo).find((text) => text.includes("a test left running")) ?? "";
      // Task 001-212: each with its parent, its age and the signal that ended it.
      const entry = (pid: number | undefined, ended: string) =>
        new RegExp(
          `${pid} \\S+ -e .+? \\(parent \\d+ [^,]+, \\d+\\.\\d s old, ${ended}, run [\\w-]+\\)`,
        );
      expect(note).toMatch(entry(detached, "SIGTERM"));
      expect(note).toMatch(entry(plain, "SIGKILL after 1 s"));
      // The run it names for each lists the test file that left them (review wave-13r B1).
      const runIds = [...note.matchAll(/, run ([\w-]+)\)/g)].map((match) => match[1]);
      expect(runIds, note).toHaveLength(2);
      expect(new Set(runIds).size, note).toBe(1);
      const runId = runIds[0];
      expect(runId, note).toBeDefined();
      const run = withStore(repo, (store) => store.runs.get(runId ?? ""));
      expect(run?.testFiles.map((ref) => ref.path)).toContain("test/escape.test.ts");
      // The daemon serves on.
      expect(await ping(repo.socketPath, 2_000)).not.toBeNull();
    });

    it("stops what the daemon's process group still holds on squeal stop", async () => {
      const pidFile = join(pidDir(), "setup.json");
      const repo = suite.fixture({
        "vitest.config.ts": SETUP_CONFIG,
        "setup.ts": forgetfulSetup(pidFile),
      });
      await start(repo);
      expect((await resultOf(repo, undefined, "test/math.test.ts")).outcome).toBe("pass");
      await waitFor(() => existsSync(pidFile), 30_000, "the setup's child started");
      const [child] = pids(pidFile);
      expect(child !== undefined && isAlive(child)).toBe(true);
      const stop = spawnCli(suite.cli, ["stop"], { cwd: repo.root, env: repo.env });
      expect(await stop.exited).toEqual({ code: 0, signal: null });
      expect(stop.stdout()).toMatch(/^Squeal daemon stopped for /);
      await waitFor(() => child !== undefined && !isAlive(child), 5_000, "the setup's child gone");
      expect(readNotes(repo)).toContainEqual(
        expect.stringMatching(
          /^stopped 1 process the runners left running when the daemon exited: /,
        ),
      );
    });

    it("leaves the rest of a pipeline it leads alone, and stops its orphan there", () => {
      const escaped = join(dirname(suite.cli), "../core/daemon/escaped.js");
      // Job control gives the pipeline its own group, led by its first process.
      const out = execFileSync("bash", ["-c", 'set -m; "$NODE" -e "$SCRIPT" | cat'], {
        encoding: "utf8",
        env: { ...process.env, NODE: process.execPath, SCRIPT: pipelineLeader(escaped) },
      });
      const pid = Number(/: (\d+) /.exec(out)?.[1]);
      suite.cleanup(() => {
        if (pid > 0 && isAlive(pid)) process.kill(pid, "SIGKILL");
      });
      const head = `stopped 1 process a test left running after its tier: ${pid} ${process.execPath} -e setTimeout(() => {}, 600000) (parent `;
      expect(out.startsWith(head), out).toBe(true);
      expect(out.slice(head.length)).toMatch(/^\d+ [^,]*, \d+\.\d s old, SIGTERM\)\n$/);
      expect(isAlive(pid)).toBe(false);
    });
  },
);
