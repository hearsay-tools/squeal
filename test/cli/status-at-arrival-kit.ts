import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, onTestFinished } from "vitest";
import { type AtDaemons, realDaemons } from "../../src/cli/status-at-daemons.js";
import { installCommitWorktree } from "../../src/core/checkout/commit-setup.js";
import { COMMIT_WORKTREES } from "../../src/core/daemon/commit-mode.js";
import { type RunningDaemon, startDaemon } from "../../src/core/daemon/daemon.js";
import { observedMetaKey } from "../../src/core/keys/observed.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { ResultRecord } from "../../src/core/types/store.js";
import { type Fixture, fixture, git, linkInstall, ref, write } from "../commit/at-keys-fixture.js";
import { childEnv } from "../daemon/helpers.js";
import { withStore } from "./status-at-kit.js";

/*
 * Review 0.1.611 B1 and 0.1.611-rereview N1 (rows 023-70, 023-76): a
 * folder-listing result that arrives after the commit daemon selected the
 * file. Commit `a` tracks one name in `test/fixtures/`; its test expects
 * two, so a pristine `a` fails. Commit `b` adds an unrelated file; the
 * caller at `b` has an ignored `extra.log` there, so its run passes. The
 * caller's narrow run holds the browser group's one slot until the test
 * opens its gate, so the commit's ask selects the file and queues it with
 * no result stored yet; then the caller's pass arrives.
 */

export const LISTS = ref("test/lists.test.ts");

export interface Arrival {
  readonly f: Fixture;
  /** Commit `a`, the commit side. */
  readonly a: string;
  /** The caller's daemon first, the commit's second once it started. */
  readonly live: RunningDaemon[];
  readonly real: AtDaemons;
  /** Lets the caller's run of the file end. */
  readonly open: () => void;
}

/**
 * Both daemons, the caller's narrow run of the file started and holding the
 * group's slot. `seeded`: an earlier run recorded the folder read, so both
 * closures list it at selection; otherwise each run observes it first (N1).
 */
export async function arrival(seeded: boolean): Promise<Arrival> {
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
  if (seeded)
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
export function pending(f: Fixture, daemon: RunningDaemon | undefined): string | null {
  let mark: string | null = null;
  withStore(f, (store) => {
    if (daemon === undefined) return;
    mark = store.testFileKeys.list(daemon.worktreeId).find((r) => r.pending)?.pending ?? null;
  });
  return mark;
}

/** Whether the commit daemon's row of the file has a key with no result stored yet. */
export function noResultYet(f: Fixture, commit: RunningDaemon | undefined): boolean {
  let none = false;
  withStore(f, (store) => {
    if (commit === undefined) return;
    none = store.testFileKeys
      .list(commit.worktreeId)
      .some((row) => row.key !== null && store.results.byKey(row.key).length === 0);
  });
  return none;
}

/** The results stored at `daemon`'s live key of the file, with that key. */
export function resultsOf(
  f: Fixture,
  daemon: RunningDaemon | undefined,
): { key: string | null; results: readonly ResultRecord[] } {
  let out: { key: string | null; results: readonly ResultRecord[] } = { key: null, results: [] };
  withStore(f, (store) => {
    if (daemon === undefined) return;
    const key = store.testFileKeys.list(daemon.worktreeId)[0]?.key ?? null;
    out = { key, results: key === null ? [] : store.results.byKey(key, 0) };
  });
  return out;
}

/**
 * `real`, noting whether the commit's ask queued the file before any result
 * was stored; with `open`, the caller's run then ends.
 */
export function watched(arrived: Arrival, seen: { before: boolean }, open = false): AtDaemons {
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

export interface Row {
  readonly path: string;
  readonly at: { readonly state: string; readonly reason?: string };
  readonly now: { readonly state: string };
}

export const rowOf = (out: string): Row | undefined =>
  (JSON.parse(out) as { files: Row[] }).files.find((file) => file.path === LISTS.path);
