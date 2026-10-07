import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureDaemon } from "../../src/core/daemon/ensure.js";
import { prepareScratch, removeScratch } from "../../src/core/daemon/scratch.js";
import { storePaths } from "../../src/core/store/index.js";
import { git } from "../hash/git-repo.js";
import {
  type BuiltCli,
  buildCli,
  LOADED,
  ping,
  SLOW,
  type SpawnedProcess,
  spawnCli,
  stopProcess,
  waitFor,
  waitReady,
} from "./helpers.js";
import {
  callerTempDir,
  daemonTempDir,
  exitWithin,
  held,
  inside,
  linkedFixture,
  resultOf,
  safe,
} from "./scratch-helpers.js";

/*
 * Spec 001 D10 as amended for lessons defect 13 and review wave 7.6: a
 * daemon holds nothing inside its worktree or inside the temp directory of
 * whoever started it, so a harness can remove the worktree under it, and
 * then it exits. Its tests see a temp directory outside every repository,
 * as under `vitest run`, and it leaves that directory behind on no exit.
 */

const processes: SpawnedProcess[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const process of processes.splice(0)) await stopProcess(process);
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** Passes only when the test's working directory is the worktree root, as under `vitest run`. */
const CWD_TEST = `import { existsSync } from "node:fs";
import { expect, it } from "vitest";
it("runs in the worktree root", () => {
  expect(existsSync("vitest.config.ts")).toBe(true);
});
`;

/** Review wave 7.6, B1: passes only when `os.tmpdir()` lies outside every git repository. */
const TMP_TEST = `import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
it("makes its temp directory outside every repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "x-"));
  expect(() =>
    execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: dir, stdio: "pipe" }),
  ).toThrow(/not a git repository/);
});
`;

const FILES = { "test/cwd.test.ts": CWD_TEST, "test/tmp.test.ts": TMP_TEST };

describe.runIf(process.platform === "linux")(
  "squeal daemon: nothing held inside the root or the spawner's temp dir (spec 001 D10)",
  SLOW,
  () => {
    let built: BuiltCli;
    beforeAll(() => {
      built = buildCli();
    });
    afterAll(() => built.cleanup());

    it("started from inside the root, it runs the root's tests with a temp dir outside every repository, holds nothing there, and exits when the worktree is removed", async () => {
      const repo = linkedFixture(cleanups, FILES);
      const callerTmp = callerTempDir(cleanups);
      const spawned = spawnCli(built.cli, ["daemon", repo.root], {
        cwd: repo.root,
        env: { ...repo.env, TMPDIR: callerTmp, TMP: callerTmp, TEMP: callerTmp },
      });
      processes.push(spawned);
      await waitReady(repo, spawned);
      const pid = spawned.child.pid ?? 0;

      // The baseline went through Vitest with the root as the tests' working
      // directory and the daemon's temp directory as their `os.tmpdir()`.
      expect((await resultOf(repo, spawned, "test/cwd.test.ts")).outcome).toBe("pass");
      expect((await resultOf(repo, spawned, "test/tmp.test.ts")).outcome).toBe("pass");
      const tempDir = daemonTempDir(repo.commonDir, repo.worktreeId);
      expect(tempDir).toMatch(/^\/tmp\/squeal-\d+\/tmp\/[0-9a-f]+$/);
      expect(readdirSync(tempDir).some((name) => name.startsWith("x-"))).toBe(true);
      expect(readdirSync(callerTmp)).toEqual([]);

      const outside = await waitFor(
        () => {
          const paths = held(pid);
          return paths.every((p) => !inside(p, repo.root) && !inside(p, callerTmp)) ? paths : null;
        },
        30_000,
        "nothing held inside the root or the caller's TMPDIR",
      ).catch((error: Error) => {
        throw new Error(`${error.message}: ${JSON.stringify(held(pid))}`);
      });
      expect(readlinkSync(`/proc/${pid}/cwd`)).toBe(storePaths(repo.commonDir).dir);
      expect(outside.length).toBeGreaterThan(1);

      // Review wave 7.6, N5: the harness's own removal, which also drops
      // `<common-dir>/worktrees/<name>`, succeeds without `--force`.
      git(repo.mainRoot, ["worktree", "remove", repo.root]);
      expect(existsSync(repo.root)).toBe(false);
      // D10's root check runs every 5 s by default.
      expect(await exitWithin(spawned, 15_000)).toEqual({ code: 0, signal: null });
      expect(existsSync(tempDir)).toBe(false);
    });

    it("answers on its socket within a hook's budget, empties its temp directory when it starts, and removes it on squeal stop", async () => {
      const repo = linkedFixture(cleanups, {});
      const tempDir = daemonTempDir(repo.commonDir, repo.worktreeId);
      // A daemon that died left its files.
      mkdirSync(tempDir, { recursive: true });
      writeFileSync(join(tempDir, "left-by-a-dead-daemon"), "");

      const started = Date.now();
      const spawned = spawnCli(built.cli, ["daemon", repo.root], { cwd: "/", env: repo.env });
      processes.push(spawned);
      await waitFor(() => ping(repo.socketPath, 100), 30_000, "a ping answer");
      const answeredMs = Date.now() - started;
      // Spec 001 D9: hooks run within 2 s; the socket is up before the runner loads.
      if (!LOADED) expect(answeredMs).toBeLessThan(2_000);
      await waitReady(repo, spawned);
      expect(readdirSync(tempDir)).toEqual([]);

      const stop = spawnCli(built.cli, ["stop"], { cwd: repo.root, env: repo.env });
      expect(await stop.exited).toEqual({ code: 0, signal: null });
      expect(await spawned.exited).toEqual({ code: 0, signal: null });
      expect(existsSync(tempDir)).toBe(false);
    });
  },
);

describe("prepareScratch and removeScratch (review wave 7.6, B1 and S1)", () => {
  function scratchIn() {
    const base = realpathSync(mkdtempSync("/tmp/sq-scratch-"));
    cleanups.push(() => rmSync(base, { recursive: true, force: true }));
    const userDir = join(base, "squeal-user");
    return { workDir: "/", userDir, tempDir: join(userDir, "tmp", "0123456789abcdef") };
  }

  it("make the user directory private and the temp directory empty, then remove the temp directory", () => {
    const scratch = scratchIn();
    prepareScratch(scratch);
    expect(statSync(scratch.userDir).mode & 0o777).toBe(0o700);
    expect(readdirSync(scratch.tempDir)).toEqual([]);
    removeScratch(scratch);
    expect(existsSync(scratch.tempDir)).toBe(false);
    expect(existsSync(scratch.userDir)).toBe(true);
  });

  it("refuse a user directory that others can enter", () => {
    const scratch = scratchIn();
    mkdirSync(scratch.userDir);
    chmodSync(scratch.userDir, 0o755);
    expect(() => prepareScratch(scratch)).toThrow(
      /temp directory .*squeal-user has mode 755, not 700; refusing to use it/,
    );
    expect(existsSync(scratch.tempDir)).toBe(false);
  });
});

describe("ensureDaemon: the spawn's working directory (spec 001 D10)", () => {
  it("is the store directory, outside a linked worktree's root", async () => {
    const repo = linkedFixture(cleanups, {});
    const record = join(repo.runtimeDir, "spawned.json");
    const stub = join(repo.runtimeDir, "stub-cli.mjs");
    writeFileSync(
      stub,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(record)}, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));\n`,
    );
    const env = { XDG_RUNTIME_DIR: repo.runtimeDir, SQUEAL_CLI: stub };
    expect(await ensureDaemon(repo.root, { env, record: null })).toBe("spawned");
    const spawned = await waitFor(
      () => safe(() => JSON.parse(readFileSync(record, "utf8")) as { cwd: string }, null),
      30_000,
      "the stub CLI's record",
    );
    expect(spawned).toEqual({ cwd: storePaths(repo.commonDir).dir, args: ["daemon", repo.root] });
  });
});
