import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { type AtDaemons, realDaemons } from "../../src/cli/status-at-daemons.js";
import { installCommitWorktree } from "../../src/core/checkout/commit-setup.js";
import { storedReason } from "../../src/core/daemon/at-asks.js";
import { COMMIT_WORKTREES } from "../../src/core/daemon/commit-mode.js";
import { type RunningDaemon, startDaemon } from "../../src/core/daemon/daemon.js";
import { observedMetaKey } from "../../src/core/keys/observed.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { type Fixture, fixture, git, linkInstall, ref, write } from "../commit/at-keys-fixture.js";
import { childEnv } from "../daemon/helpers.js";
import { run, withStore } from "./status-at-kit.js";

/*
 * Review 0.1.611 B1 (row 023-70, spec 023 D4.9): a result another worktree
 * writes after the commit daemon selected the file. Commit `a` tracks one
 * name in `test/fixtures/`; its test expects two, so a pristine `a` fails.
 * Commit `b` adds an unrelated file; the caller at `b` has an ignored
 * `extra.log` there, so its run passes, at the key `a` shares (a folder
 * read's key hashes the tracked names). An earlier run recorded the folder
 * read, so both daemons' closures list it. The caller's narrow run holds
 * the browser group's one slot until the test opens its gate, so the
 * commit's ask selects the file and queues it with no result stored yet;
 * then the caller's pass arrives. Before the fix, the commit side read that pass as its own:
 * "unchanged", exit 0. Now it reads not comparable, exit 3, during the
 * `--run` that waits (the reviewer's probe) and in a `--wait` that joins
 * the ask later. The pre-stored refusal, clean reuse and the commit
 * worktree's own folder run are `status-at-stored-refused.test.ts` and
 * `status-at-commit-listing.test.ts`.
 */

const LISTS = ref("test/lists.test.ts");
const REASON = storedReason("test/fixtures/");

interface Arrival {
  readonly f: Fixture;
  /** Commit `a`, the commit side. */
  readonly a: string;
  readonly live: RunningDaemon[];
  readonly real: AtDaemons;
  /** Lets the caller's run of the file end. */
  readonly open: () => void;
}

/** Both daemons, the caller's narrow run of the file started and holding the group's slot. */
async function arrival(): Promise<Arrival> {
  const runtime = realpathSync(mkdtempSync("/tmp/sq-arrival-"));
  const gate = join(runtime, "open");
  const f = fixture({
    "squeal.config.json": JSON.stringify({
      checks: [
        {
          name: "browser",
          runner: "vitest",
          tests: ["test/*.test.ts"],
          at: "manual",
          limits: { maxParallel: 1, maxWorkers: 1, priority: "low" },
        },
      ],
    }),
    ".gitignore": "node_modules/\n*.log\n",
    "test/fixtures/a.json": "{}\n",
    [LISTS.path]: [
      'import { existsSync, readdirSync } from "node:fs";',
      'import { expect, it } from "vitest";',
      'it("lists", async () => {',
      `  while (!existsSync(${JSON.stringify(gate)})) await new Promise((r) => setTimeout(r, 50));`,
      '  expect(readdirSync(new URL("./fixtures", import.meta.url)).length).toBe(2);',
      "}, 60000);",
      "",
    ].join("\n"),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "change.txt": "unrelated\n" });
  // A previous run at another key recorded this read. Neither current key has a result yet.
  withStore(f, (store) =>
    store.meta.set(observedMetaKey(""), JSON.stringify({ [LISTS.path]: ["test/fixtures/"] })),
  );
  write(f.root, { "test/fixtures/extra.log": "x" });
  const live: RunningDaemon[] = [];
  onTestFinished(async () => {
    for (const daemon of live) await daemon.stop("stop-requested");
    rmSync(runtime, { recursive: true, force: true });
  }, 60_000);
  const start = async (root: AbsolutePath) => {
    const daemon = await startDaemon({
      root,
      env: childEnv(runtime),
      commitWorktrees: {
        ...COMMIT_WORKTREES,
        install: (tree) => installCommitWorktree(tree, { install: linkInstall().install }),
      },
    });
    if ("reason" in daemon) throw new Error(daemon.message);
    live.push(daemon);
    await daemon.ready;
    return daemon;
  };
  const real = realDaemons({
    start: async (tree) => {
      const daemon = await start(tree);
      return { lives: async () => live.includes(daemon) };
    },
    startWorktree: async (root) => {
      await start(root);
      return null;
    },
  });
  const bound = Date.now() + 120_000;
  expect(await real.worktree(f.root, bound)).toBeNull();
  expect(await real.ask(f.root, "browser", [LISTS.path], bound, { lead: true })).toBe("taken");
  await expect.poll(() => pending(f, live[0]), { timeout: 20_000 }).toBe("running");
  return { f, a, live, real, open: () => writeFileSync(gate, "") };
}

/** The file's pending mark in `daemon`'s rows. */
function pending(f: Fixture, daemon: RunningDaemon | undefined): string | null {
  let mark: string | null = null;
  withStore(f, (store) => {
    if (daemon === undefined) return;
    mark = store.testFileKeys.list(daemon.worktreeId).find((r) => r.pending)?.pending ?? null;
  });
  return mark;
}

/** Whether the commit daemon's row of the file has a key with no result stored yet. */
function noResultYet(f: Fixture, commit: RunningDaemon | undefined): boolean {
  let none = false;
  withStore(f, (store) => {
    if (commit === undefined) return;
    none = store.testFileKeys
      .list(commit.worktreeId)
      .some((row) => row.key !== null && store.results.byKey(row.key).length === 0);
  });
  return none;
}

/**
 * `real`, noting whether the commit's ask queued the file before any result
 * was stored; with `open`, the caller's run then ends.
 */
function watched(arrived: Arrival, seen: { before: boolean }, open = false): AtDaemons {
  const { f, live, real } = arrived;
  return {
    ...real,
    commitRead: async (...args) => {
      const answer = await real.commitRead(...args);
      if (
        typeof answer !== "string" &&
        answer.asks.some((ask) => ask.phase === "queued" && ask.files.length === 1) &&
        noResultYet(f, live[1])
      )
        seen.before = true;
      if (seen.before && open) arrived.open();
      return answer;
    },
  };
}

interface Row {
  readonly path: string;
  readonly at: { readonly state: string; readonly reason?: string };
  readonly now: { readonly state: string };
}

const rowOf = (out: string): Row | undefined =>
  (JSON.parse(out) as { files: Row[] }).files.find((file) => file.path === LISTS.path);

describe("a foreign folder result that arrives after selection (review 0.1.611 B1)", {
  timeout: 180_000,
}, () => {
  it("is not the commit's in the --run call that waits for it", async () => {
    const arrived = await arrival();
    const seen = { before: false };
    const out = await run(
      arrived.f,
      {
        commit: arrived.a,
        paths: [LISTS.path],
        run: { allMissing: false },
        json: true,
        waitMs: 60_000,
      },
      { cacheRoot: arrived.f.cacheRoot, daemons: watched(arrived, seen, true) },
    );
    const row = rowOf(out.out);
    expect(seen.before, "the commit selected the file before any result was stored").toBe(true);
    expect(row?.now.state).toBe("pass");
    expect(row?.at, "a pristine commit has one name; the foreign run saw two").toEqual({
      state: "not comparable",
      reason: REASON,
    });
    expect(out.code).toBe(3);
  });

  it("is not the commit's in a --wait that joins the queued ask after it arrived", async () => {
    const arrived = await arrival();
    const { f, a, live } = arrived;
    const seen = { before: false };
    const daemons = watched(arrived, seen);
    // The `--run` call ends at its wait while its ask is queued behind the caller's run.
    const first = await run(
      f,
      { commit: a, paths: [LISTS.path], run: { allMissing: false }, json: true, waitMs: 20_000 },
      { cacheRoot: f.cacheRoot, daemons },
    );
    expect(seen.before).toBe(true);
    expect(rowOf(first.out)?.at.state).toBe("no result");
    // The caller's pass arrives at the key the commit shares; the ask stays as it was.
    arrived.open();
    await expect.poll(() => pending(f, live[0]), { timeout: 60_000 }).toBeNull();
    await expect.poll(() => noResultYet(f, live[1]), { timeout: 20_000 }).toBe(false);
    const joined = await run(
      f,
      { commit: a, paths: [LISTS.path], json: true, waitMs: 30_000 },
      { cacheRoot: f.cacheRoot, daemons },
    );
    expect(rowOf(joined.out)?.at).toEqual({ state: "not comparable", reason: REASON });
    expect(joined.code).toBe(3);
  });
});
