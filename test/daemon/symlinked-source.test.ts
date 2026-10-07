import { mkdtempSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readHeader } from "../../src/core/delivery/index.js";
import type { Store } from "../../src/core/types/index.js";
import { buildDist } from "../../src/harness/build.js";
import { CLAUDE_CODE_PLUGIN } from "../../src/harness/claude-code/build.js";
import { CODEX_PLUGIN } from "../../src/harness/codex/build.js";
import { runBundle } from "../harness/bundle-helpers.js";
import { codexRecorded, sessionOf } from "../harness/codex/helpers.js";
import { recorded } from "../harness/helpers.js";
import { git } from "../hash/git-repo.js";
import {
  daemonSuite,
  type FixtureRepo,
  SLOW,
  spawnCli,
  waitFor,
  waitReady,
  withStore,
} from "./helpers.js";

/*
 * Review wave 11f, B1 (task 001-118): the scheduler fixture with `src` a link
 * to a sibling directory, the runner keeping the link's paths. A test file
 * added behind the link is listed, run and reported through both plugins'
 * tool boundary hooks, and a forced checkpoint after it includes it.
 */
const CONFIG = `import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { preserveSymlinks: true },
  test: { include: ["test/**/*.test.ts", "src/**/*.test.ts"] },
});
`;
const ADDED = "src/added.test.ts";
/** Well inside the 30 s idle reconciliation, which would find the file without the watcher. */
const WATCHED_MS = 10_000;
const CODEX_SESSION = sessionOf("exec", "session-start");

let bundles: { claude: string; codex: string } | null = null;
beforeAll(async () => {
  const claude = mkdtempSync("/tmp/sq-claude-");
  const codex = mkdtempSync("/tmp/sq-codex-");
  await Promise.all([buildDist(CLAUDE_CODE_PLUGIN, claude), buildDist(CODEX_PLUGIN, codex)]);
  bundles = { claude, codex };
}, 120_000);
afterAll(() => {
  for (const dir of Object.values(bundles ?? {})) rmSync(dir, { recursive: true, force: true });
});

/** Both plugins' hooks against one worktree: SessionStart, then each tool boundary. */
function plugins(repo: FixtureRepo, cli: string) {
  if (bundles === null) throw new Error("bundles are built in beforeAll");
  const { claude, codex } = bundles;
  const env = { XDG_RUNTIME_DIR: repo.runtimeDir, SQUEAL_CLI: cli };
  return {
    start: () =>
      Promise.all([
        runBundle("session-start", recorded("session-start", repo.root), env, claude),
        runBundle(
          "session-start",
          codexRecorded("exec", "session-start", repo.root, CODEX_SESSION),
          env,
          codex,
        ),
      ]),
    boundary: () =>
      Promise.all([
        runBundle("post-tool-batch", recorded("post-tool-batch", repo.root), env, claude),
        runBundle(
          "post-tool-use",
          codexRecorded("exec", "post-tool-use", repo.root, CODEX_SESSION),
          env,
          codex,
        ),
      ]),
  };
}

function linkSource(repo: FixtureRepo): void {
  const linked = join(repo.root, "../linked-source");
  renameSync(join(repo.root, "src"), linked);
  symlinkSync("../linked-source", join(repo.root, "src"));
  writeFileSync(join(repo.root, "vitest.config.ts"), CONFIG);
  git(repo.root, ["add", "-A"]);
  git(repo.root, ["commit", "-qm", "src is a link"]);
}

/** The first revision after `after` whose changes name `path`, or `null`. */
function revisionWith(store: Store, repo: FixtureRepo, after: number, path: string) {
  const latest = store.revisions.latest(repo.worktreeId)?.number ?? 0;
  return (
    store.revisions
      .range(repo.worktreeId, after, latest)
      .find((r) => r.changes.some((c) => c.path === path)) ?? null
  );
}

const listed = (store: Store, repo: FixtureRepo) =>
  store.testFileKeys.list(repo.worktreeId).map((k) => k.testFile.path);

describe(
  "squeal daemon in a worktree whose src is a symlink (D2, review wave 11f B1)",
  SLOW,
  () => {
    const suite = daemonSuite();

    it("lists, runs and reports a test added behind the link, and checkpoints it", async () => {
      const repo = suite.fixture();
      linkSource(repo);
      const spawned = suite.daemon(repo);
      await waitReady(repo, spawned);
      await waitFor(
        () =>
          withStore(repo, (store) => {
            const header = readHeader(store, repo.worktreeId);
            return header.counts.current >= 11 && header.counts.pending === 0;
          }),
        90_000,
        "baseline",
      );
      expect(withStore(repo, (store) => listed(store, repo)).length).toBe(5);
      const hooks = plugins(repo, suite.cli);
      for (const start of await hooks.start()) expect(start).toMatchObject({ code: 0, stderr: "" });

      // An added test behind the link enters a revision through the watcher.
      const before = withStore(
        repo,
        (store) => store.revisions.latest(repo.worktreeId)?.number ?? 0,
      );
      writeFileSync(
        join(repo.root, ADDED),
        `import { expect, it } from "vitest";\nit("new failure", () => expect(1).toBe(2));\n`,
      );
      await waitFor(
        () => withStore(repo, (store) => revisionWith(store, repo, before, ADDED)),
        WATCHED_MS,
        "a revision adding the test",
      );
      await waitFor(
        () =>
          withStore(repo, (store) =>
            store.knownStates
              .list(repo.worktreeId)
              .some((s) => s.check.testPath === ADDED && s.outcome === "fail"),
          ),
        60_000,
        "the added test failed",
      );
      expect(withStore(repo, (store) => listed(store, repo))).toContain(ADDED);
      for (const out of await hooks.boundary()) {
        expect(out).toMatchObject({ code: 0, stderr: "" });
        expect(out.stdout).toContain("FAIL");
        expect(out.stdout).toContain("added.test.ts");
      }

      // A forced checkpoint now runs six files and completes.
      const run = spawnCli(suite.cli, ["run", "--all", "--force", "--wait"], {
        cwd: repo.root,
        env: repo.env,
      });
      await run.exited;
      expect(run.stdout()).toMatch(/started at revision \d+: 6 test files/);
      // It completes with the added test among its failures.
      expect(run.stdout()).toMatch(/Checkpoint \S+ completed\n/);
      expect(run.stdout()).toContain("FAIL  src/added.test.ts > new failure");

      // An existing source behind the link is observed directly, not by the idle pass.
      const edited = withStore(
        repo,
        (store) => store.revisions.latest(repo.worktreeId)?.number ?? 0,
      );
      writeFileSync(
        join(repo.root, "src/math.ts"),
        "export const add = (a: number, b: number) => a - b;\n",
      );
      await waitFor(
        () => withStore(repo, (store) => revisionWith(store, repo, edited, "src/math.ts")),
        WATCHED_MS,
        "a revision editing src/math.ts",
      );

      // Deleting the added test retires it.
      unlinkSync(join(repo.root, ADDED));
      await waitFor(
        () => withStore(repo, (store) => !listed(store, repo).includes(ADDED)),
        60_000,
        "the added test unlisted",
      );
    });
  },
);
