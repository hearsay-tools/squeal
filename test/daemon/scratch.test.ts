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
import { basename, dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureDaemon } from "../../src/core/daemon/ensure.js";
import { daemonScratch, prepareScratch, removeScratch } from "../../src/core/daemon/scratch.js";
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
  exitWithin,
  held,
  inside,
  linkedFixture,
  resultOf,
  safe,
  TMP_TEST,
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
      const tempDir = daemonScratch(repo.commonDir, repo.root).tempDir;
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

    it("answers on its socket within a hook's budget, empties its temp directory when it starts and removes the leftover after, and removes it on squeal stop", async () => {
      const repo = linkedFixture(cleanups, {});
      const tempDir = daemonScratch(repo.commonDir, repo.root).tempDir;
      // A daemon that died left its files, too many to remove before the socket.
      mkdirSync(join(tempDir, "left-by-a-dead-daemon"), { recursive: true });
      for (let i = 0; i < 2_000; i++) {
        writeFileSync(join(tempDir, "left-by-a-dead-daemon", String(i)), "");
      }

      const started = Date.now();
      const spawned = spawnCli(built.cli, ["daemon", repo.root], { cwd: "/", env: repo.env });
      processes.push(spawned);
      await waitFor(() => ping(repo.socketPath, 100), 30_000, "a ping answer");
      const answeredMs = Date.now() - started;
      // Spec 001 D9: hooks run within 2 s; the socket is up before the runner loads.
      if (!LOADED) expect(answeredMs).toBeLessThan(2_000);
      await waitReady(repo, spawned);
      expect(readdirSync(tempDir)).toEqual([]);
      // Review wave 7.7, N1: moved aside and removed in the background.
      await waitFor(
        () =>
          readdirSync(dirname(tempDir)).every((name) => !name.startsWith(`${basename(tempDir)}.`)),
        30_000,
        "the leftover removed",
      );

      const stop = spawnCli(built.cli, ["stop"], { cwd: repo.root, env: repo.env });
      expect(await stop.exited).toEqual({ code: 0, signal: null });
      expect(await spawned.exited).toEqual({ code: 0, signal: null });
      expect(existsSync(tempDir)).toBe(false);
    });
  },
);

describe("prepareScratch and removeScratch (review wave 7.6, B1 and S1; wave 7.7, N1 and N2)", () => {
  function scratchIn() {
    const base = realpathSync(mkdtempSync("/tmp/sq-scratch-"));
    cleanups.push(() => rmSync(base, { recursive: true, force: true }));
    const userDir = join(base, "squeal-user");
    return { workDir: "/", userDir, tempDir: join(userDir, "tmp", "0123456789abcdef") };
  }

  it("make the user directory private and the temp directory empty, then remove the temp directory", async () => {
    const scratch = scratchIn();
    const prepared = prepareScratch(scratch);
    expect(prepared.scratch).toEqual(scratch);
    expect(prepared.refusal).toBeNull();
    expect(statSync(scratch.userDir).mode & 0o777).toBe(0o700);
    expect(readdirSync(scratch.tempDir)).toEqual([]);
    await prepared.leftovers;
    removeScratch(scratch);
    expect(existsSync(scratch.tempDir)).toBe(false);
    expect(existsSync(scratch.userDir)).toBe(true);
  });

  it("move a leftover aside and remove it after returning, so its size never delays the socket", async () => {
    const scratch = scratchIn();
    mkdirSync(scratch.userDir, { mode: 0o700 });
    mkdirSync(scratch.tempDir, { recursive: true });
    for (let i = 0; i < 50; i++) writeFileSync(join(scratch.tempDir, `left-${i}`), "");
    const prepared = prepareScratch(scratch);
    expect(readdirSync(scratch.tempDir)).toEqual([]);
    const aside = readdirSync(join(scratch.userDir, "tmp")).filter((n) => n.includes(".old-"));
    expect(aside).toHaveLength(1);
    expect(readdirSync(join(scratch.userDir, "tmp", aside[0] ?? ""))).toHaveLength(50);
    await prepared.leftovers;
    expect(readdirSync(join(scratch.userDir, "tmp"))).toEqual(["0123456789abcdef"]);
  });

  it("remove what was moved aside with the temp directory", () => {
    const scratch = scratchIn();
    mkdirSync(`${scratch.tempDir}.old-dead`, { recursive: true });
    mkdirSync(scratch.tempDir);
    removeScratch(scratch);
    expect(readdirSync(join(scratch.userDir, "tmp"))).toEqual([]);
  });

  it("refuse a user directory that others can enter, and use a private directory of the daemon's own", async () => {
    const scratch = scratchIn();
    mkdirSync(scratch.userDir);
    chmodSync(scratch.userDir, 0o755);
    const first = prepareScratch(scratch);
    expect(first.refusal).toMatch(
      /^temp directory .*squeal-user has mode 755, not 700; refusing to use it; using .*squeal-user-0123456789abcdef-\w{6} instead$/,
    );
    const fallback = first.scratch.tempDir;
    expect(fallback.startsWith(`${scratch.userDir}-0123456789abcdef-`)).toBe(true);
    expect(statSync(fallback).mode & 0o777).toBe(0o700);
    expect(readdirSync(fallback)).toEqual([]);
    expect(existsSync(join(scratch.userDir, "tmp"))).toBe(false);

    // A daemon that died left its fallback; the next one of the key removes it.
    const second = prepareScratch(scratch);
    await second.leftovers;
    expect(existsSync(fallback)).toBe(false);
    removeScratch(second.scratch);
    expect(existsSync(second.scratch.tempDir)).toBe(false);
  });
});

describe("daemonScratch: the temp directory's key (review wave 7.7, B1)", () => {
  function commonDir(): string {
    const dir = realpathSync(mkdtempSync("/tmp/sq-common-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  }

  it("is stable for one repository and root, and differs for another root", () => {
    const common = commonDir();
    const first = daemonScratch(common, "/work/a").tempDir;
    expect(daemonScratch(common, "/work/a").tempDir).toBe(first);
    expect(daemonScratch(common, "/work/b").tempDir).not.toBe(first);
    expect(readFileSync(join(common, "squeal/repository-id"), "utf8")).toMatch(/^[0-9a-f]{32}\n$/);
  });

  it("differs for another repository at the same root, and for one cloned again in place", () => {
    const common = commonDir();
    const first = daemonScratch(common, "/work/a").tempDir;
    expect(daemonScratch(commonDir(), "/work/a").tempDir).not.toBe(first);
    rmSync(join(common, "squeal"), { recursive: true });
    expect(daemonScratch(common, "/work/a").tempDir).not.toBe(first);
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
