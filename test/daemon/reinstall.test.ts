import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { readHeader } from "../../src/core/delivery/index.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { REINSTALL_NOTE } from "../../src/core/scheduler/index.js";
import { storePaths } from "../../src/core/store/index.js";
import { git } from "../hash/git-repo.js";
import {
  childEnv,
  daemonSuite,
  type FixtureRepo,
  readNotes,
  SLOW,
  waitFor,
  waitReady,
  withStore,
} from "./helpers.js";

/*
 * Task 001-113, review wave 11c B1 and B2 on a real daemon: `npm ci` under a
 * running daemon removes `node_modules` while the agent edits. The daemon
 * exits with code 0 and clears its record; the next daemon, as the next hook
 * spawns it, waits for the install with no runner open, and after it runs
 * the edited module's test first, against the new code, which fails.
 */
const repoRoot = resolve(import.meta.dirname, "../..");
const MANIFEST = JSON.stringify({ type: "module", devDependencies: { vitest: "*" } });

/** The scheduler fixture under /tmp, with this repository's Vitest linked as its install. */
function installedWorktree(): FixtureRepo {
  const dir = realpathSync(mkdtempSync("/tmp/sq-reinstall-"));
  const main = join(dir, "main");
  cpSync(join(repoRoot, "test/fixtures/scheduler/basic"), main, { recursive: true });
  renameSync(join(main, "_gitignore"), join(main, ".gitignore"));
  writeFileSync(join(main, "package.json"), MANIFEST);
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["add", "-A"]);
  git(main, ["commit", "-qm", "fixture"]);
  install(main);
  const worktreeId = worktreeIdFor(main);
  const runtimeDir = realpathSync(mkdtempSync("/tmp/sq-"));
  return {
    root: main,
    commonDir: join(main, ".git"),
    worktreeId,
    runtimeDir,
    socketPath: socketPathFor(worktreeId, { XDG_RUNTIME_DIR: runtimeDir }),
    env: childEnv(runtimeDir),
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(runtimeDir, { recursive: true, force: true });
    },
  };
}

function install(root: string): void {
  mkdirSync(join(root, "node_modules"), { recursive: true });
  symlinkSync(join(repoRoot, "node_modules/vitest"), join(root, "node_modules/vitest"));
  writeFileSync(
    join(root, "node_modules/.package-lock.json"),
    JSON.stringify({
      packages: {
        "node_modules/vitest": { link: true, resolved: join(repoRoot, "node_modules/vitest") },
      },
    }),
  );
}

/** Test files of each run of the worktree, oldest first, with when it started. */
function runs(repo: FixtureRepo): { startedAt: number; testFiles: string[] }[] {
  const db = new DatabaseSync(storePaths(repo.commonDir).database, { readOnly: true });
  try {
    const rows = db
      .prepare(
        "SELECT started_at, test_files FROM runs WHERE worktree_id = ? ORDER BY started_at, rowid",
      )
      .all(repo.worktreeId) as { started_at: number; test_files: string }[];
    return rows.map((row) => ({
      startedAt: row.started_at,
      testFiles: (JSON.parse(row.test_files) as { path: string }[]).map((f) => f.path),
    }));
  } finally {
    db.close();
  }
}

/** The outcome of `adds` in `test/math.test.ts`, as the worktree knows it. */
function mathOutcome(repo: FixtureRepo): string | null {
  return withStore(repo, (store) => {
    const state = store.knownStates
      .list(repo.worktreeId)
      .find((s) => s.check.kind === "test" && s.check.testPath === "test/math.test.ts");
    return state?.outcome ?? null;
  });
}

describe("squeal daemon: a reinstall under it (task 001-113)", SLOW, () => {
  const suite = daemonSuite();

  it("exits at npm ci with an edit, and the next daemon runs the edit first and fails it", async () => {
    const repo = installedWorktree();
    suite.cleanup(repo.cleanup);
    const first = suite.daemon(repo);
    await waitReady(repo, first);
    await waitFor(
      () =>
        withStore(repo, (store) => {
          const header = readHeader(store, repo.worktreeId);
          return header.counts.current >= 5 && header.counts.pending === 0;
        }),
      90_000,
      "baseline",
    );
    expect(mathOutcome(repo)).toBe("pass");

    // `npm ci` removes node_modules first; the agent edits meanwhile.
    rmSync(join(repo.root, "node_modules"), { recursive: true, force: true });
    writeFileSync(
      join(repo.root, "src/math.ts"),
      "export const add = (a: number, b: number) => a - b;\n",
    );
    const exit = await Promise.race([
      first.exited,
      new Promise<null>((done) => setTimeout(() => done(null), 60_000)),
    ]);
    expect(exit).toEqual({ code: 0, signal: null });
    const exitedAt = Date.now();
    expect(readNotes(repo).filter((text) => text === REINSTALL_NOTE)).toHaveLength(1);
    withStore(repo, (store) => {
      expect(store.worktrees.get(repo.worktreeId)?.daemon).toBeNull();
      expect(readHeader(store, repo.worktreeId).awaitingInstall).toBeUndefined();
    });
    expect(mathOutcome(repo)).toBe("pass");

    // The install ends; the next hook finds no daemon and spawns one.
    install(repo.root);
    const next = suite.daemon(repo);
    await waitReady(repo, next);
    await waitFor(() => mathOutcome(repo) === "fail", 90_000, "math.test.ts failing");
    const after = runs(repo).filter((run) => run.startedAt >= exitedAt);
    expect(after[0]?.testFiles).toContain("test/math.test.ts");
    withStore(repo, (store) => {
      const header = readHeader(store, repo.worktreeId);
      expect(header.awaitingInstall).toBeUndefined();
      expect(header.counts.unknown).toBe(0);
    });
  });
});
