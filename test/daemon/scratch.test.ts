import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, sep } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureDaemon } from "../../src/core/daemon/ensure.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { storePaths, worktreeIdFor } from "../../src/core/store/index.js";
import { git } from "../hash/git-repo.js";
import {
  type BuiltCli,
  buildCli,
  createFixtureRepo,
  diagnose,
  type FixtureRepo,
  SLOW,
  type SpawnedProcess,
  spawnCli,
  stopProcess,
  waitFor,
  waitReady,
  withStore,
} from "./helpers.js";

/*
 * Spec 001 D10 as amended for lessons defect 13: a daemon holds nothing
 * inside its worktree or inside the temp directory of whoever started it, so
 * a harness can delete the worktree under it, and then it exits.
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

/** A linked worktree of a fresh fixture, so its common dir lies outside its root. */
function linkedFixture(): FixtureRepo {
  const repo = createFixtureRepo({ files: { "test/cwd.test.ts": CWD_TEST } });
  cleanups.push(repo.cleanup);
  const linkedRoot = join(repo.root, "..", "linked");
  git(repo.root, ["worktree", "add", "-q", "--detach", linkedRoot]);
  const root = realpathSync(linkedRoot);
  const worktreeId = worktreeIdFor(root);
  return {
    ...repo,
    root,
    worktreeId,
    socketPath: socketPathFor(worktreeId, { XDG_RUNTIME_DIR: repo.runtimeDir }),
  };
}

/** A directory of the test's own standing in for the spawner's `TMPDIR`. */
function callerTempDir(): string {
  const dir = realpathSync(mkdtempSync("/tmp/sq-caller-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The process and its descendants. */
function tree(pid: number): number[] {
  const all = [pid];
  for (let i = 0; i < all.length; i++) {
    const tasks = join("/proc", String(all[i]), "task");
    for (const task of safe(() => readdirSync(tasks), [])) {
      const children = safe(() => readFileSync(join(tasks, task, "children"), "utf8"), "");
      all.push(...children.split(" ").filter(Boolean).map(Number));
    }
  }
  return all;
}

/** Working directory and open files of `pid` and its descendants, as paths. */
function held(pid: number): string[] {
  const paths: string[] = [];
  for (const each of tree(pid)) {
    const proc = join("/proc", String(each));
    paths.push(safe(() => readlinkSync(join(proc, "cwd")), ""));
    for (const fd of safe(() => readdirSync(join(proc, "fd")), [])) {
      paths.push(safe(() => readlinkSync(join(proc, "fd", fd)), ""));
    }
  }
  // Sockets, pipes and inotify handles have no path.
  return paths.filter((path) => path.startsWith("/"));
}

const inside = (path: string, dir: string) => path === dir || path.startsWith(dir + sep);

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

describe.runIf(process.platform === "linux")(
  "squeal daemon: nothing held inside the root or the spawner's temp dir (spec 001 D10)",
  SLOW,
  () => {
    let built: BuiltCli;
    beforeAll(() => {
      built = buildCli();
    });
    afterAll(() => built.cleanup());

    it("started from inside the root, it runs the root's tests, then holds nothing there and exits when the root is deleted", async () => {
      const repo = linkedFixture();
      const callerTmp = callerTempDir();
      const spawned = spawnCli(built.cli, ["daemon", repo.root], {
        cwd: repo.root,
        env: { ...repo.env, TMPDIR: callerTmp, TMP: callerTmp, TEMP: callerTmp },
      });
      processes.push(spawned);
      await waitReady(repo, spawned);
      const pid = spawned.child.pid ?? 0;

      // The baseline run went through Vitest with the root as the tests' working directory.
      const cwdCheck = await waitFor(
        () =>
          withStore(repo, (store) =>
            store.knownStates
              .list(repo.worktreeId)
              .find(
                (s) =>
                  s.check.kind === "test" &&
                  s.check.testPath === "test/cwd.test.ts" &&
                  s.outcome !== "unknown",
              ),
          ),
        120_000,
        "a result for test/cwd.test.ts",
      ).catch((error: Error) => {
        const states = withStore(repo, (store) => store.knownStates.list(repo.worktreeId));
        throw new Error(
          `${error.message}: ${JSON.stringify(states.slice(0, 3))} ${diagnose(repo, spawned)}`,
        );
      });
      expect(cwdCheck.outcome).toBe("pass");

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
      const { dir } = storePaths(repo.commonDir);
      expect(readlinkSync(`/proc/${pid}/cwd`)).toBe(dir);
      expect(outside.length).toBeGreaterThan(1);

      // Vitest's temp directory is the daemon's, under the store; the caller's stays empty.
      const tempDir = join(dir, "tmp", repo.worktreeId);
      expect(readdirSync(tempDir).length).toBeGreaterThan(0);
      expect(readdirSync(callerTmp)).toEqual([]);

      rmSync(repo.root, { recursive: true, force: true });
      // D10's root check runs every 5 s by default.
      const exit = await Promise.race([
        spawned.exited,
        new Promise((done) => setTimeout(() => done(null), 15_000)),
      ]);
      expect(exit).toEqual({ code: 0, signal: null });
    });

    it("empties its temp directory when it starts", async () => {
      const repo = linkedFixture();
      const tempDir = join(storePaths(repo.commonDir).dir, "tmp", repo.worktreeId);
      const spawned = spawnCli(built.cli, ["daemon", repo.root], { cwd: "/", env: repo.env });
      processes.push(spawned);
      await waitReady(repo, spawned);
      await stopProcess(spawned);
      writeFileSync(join(tempDir, "left-by-a-dead-daemon"), "");

      const again = spawnCli(built.cli, ["daemon", repo.root], { cwd: "/", env: repo.env });
      processes.push(again);
      await waitReady(repo, again);
      expect(existsSync(join(tempDir, "left-by-a-dead-daemon"))).toBe(false);
    });
  },
);

describe("ensureDaemon: the spawn's working directory (spec 001 D10)", () => {
  it("is the store directory, outside a linked worktree's root", async () => {
    const repo = linkedFixture();
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
