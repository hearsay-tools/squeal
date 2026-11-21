import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { knownState, result } from "../store/helpers.js";
import { liveDaemon } from "./status-at-daemon.js";
import { check, run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-40a (spec 023 D7.3, research `run-wait-model.md` Q7; row 023-40c,
 * D7.3 as amended) on a `$TMPDIR` git fixture with stand-in daemons: `--run`
 * sends the commit daemon one ask (the change and the named file), which
 * selects and queues there, and this worktree's daemon one request per
 * group with the named file leading; a call whose wait ends with work still
 * running exits 3 with Q7's line; `--wait` without `--run` joins and queues
 * nothing; the later call reads what the daemons stored, at the commit
 * daemon's live keys (its rows).
 */

const TEST = ref("test/a.test.ts");

/** Commit A, then HEAD changes `src/a.ts` and the test; a live daemon in the worktree lists the test. */
function changed() {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 1;\n",
    [TEST.path]: testOf("a", 1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: testOf("a", 2) });
  withStore(f, (store) => liveDaemon(f, store, [TEST]));
  return { f, a, tree: standInTree(f) };
}

/** The key a stand-in daemon gives `ref`: `commit-<path>` in the commit tree, `daemon-<path>` here. */
const keyIn = (f: Fixture, root: string, ref: TestFileRef) =>
  `${root === f.root ? "daemon" : "commit"}-${ref.path}`;

/** Marks `files` in the daemon of `root` as queued, running, or done (`null`). */
function pending(
  f: Fixture,
  root: string,
  files: readonly TestFileRef[],
  phase: "queued" | "running" | null,
): void {
  withStore(f, (store) =>
    store.testFileKeys.upsertMany(
      files.map((testFile) => ({
        worktreeId: worktreeIdFor(root as AbsolutePath),
        testFile,
        key: keyIn(f, root, testFile),
        revision: 2,
        pending: phase,
      })),
    ),
  );
}

type Side = { state: string; key?: string; pending?: string; origin?: { kind: string } };
const fileOf = (out: string) =>
  (JSON.parse(out).files as { path: string; at: Side; now: Side }[]).find(
    (file) => file.path === TEST.path,
  );

describe("status --at --run on the daemons (row 023-40, D7.3; row 023-40c)", SLOW, () => {
  it("exits 3 with Q7's line while work runs; --wait joins it, queues nothing, and reads what was stored", async () => {
    const { f, a, tree } = changed();
    // One stand-in pair for both calls: the commit daemon keeps the first call's ask.
    let play = (root: string, files: readonly TestFileRef[]) =>
      pending(f, root, files, root === tree ? "running" : "queued");
    const daemons = standIn(tree, (root, files) => play(root, files), {
      rows: (at, files) => pending(f, at, files, "queued"),
    });
    const install = linkInstall().install;
    const options = { cacheRoot: f.cacheRoot, install, daemons: daemons.ports };
    const args = { commit: a, paths: [TEST.path], run: { allMissing: false } };

    const json = await run(f, { ...args, json: true }, options);
    expect(json.code).toBe(3);
    expect(daemons.commits).toEqual([a]);
    // One ask of the commit daemon with the change and the named file; it keys and selects itself.
    expect(daemons.commitAsks).toEqual([
      expect.objectContaining({
        named: [TEST.path],
        changed: expect.arrayContaining(["src/a.ts", TEST.path]),
        allMissing: false,
      }),
    ]);
    // One request to the worktree's daemon, the named file leading; it was ensured.
    expect(daemons.asks.map((ask) => [ask.root, ask.paths, ask.call.lead])).toEqual([
      [f.root, [TEST.path], true],
    ]);
    expect(daemons.started).toEqual([f.root]);
    expect(fileOf(json.out)).toMatchObject({
      at: { state: "no result", key: `commit-${TEST.path}`, pending: "running" },
      now: { state: "no result", pending: "queued" },
    });
    const report = JSON.parse(json.out);
    expect(report.version).toBe("squeal-status-at/2");
    expect(report.run).toMatchObject({
      mode: "queue",
      waitMs: 100_000,
      commit: { files: 1, known: 0, running: 1, tree },
      now: { files: 1, known: 0, running: 1 },
      again: `squeal status --at ${a} ${TEST.path} --wait 100000`,
    });

    const text = await run(f, { ...args, waitMs: 5000 }, options);
    expect(text.code).toBe(3);
    const at = a.slice(0, 9);
    expect(text.out.trimEnd().split("\n").at(-1)).toBe(
      `1 still running at ${at} (its worktree), 1 in the working tree; their runs go on in the daemons. squeal status --at ${a} ${TEST.path} --wait 100000 waits for them; squeal ps shows them.`,
    );
    expect(text.out).toContain(
      `--run: queued 1 test files with no result at ${at} in its commit daemon (its worktree ${tree}); 0 have a result now`,
    );

    // The runs end while a later call waits: it joins them and asks nothing.
    const asked = { commit: daemons.commitAsks.length, now: daemons.asks.length };
    const commits = daemons.commits.length;
    const started = daemons.started.length;
    const waits = daemons.waits.length;
    play = (root, files) => {
      const own = worktreeIdFor(f.root);
      const id = root === tree ? worktreeIdFor(tree) : own;
      withStore(f, (store) =>
        store.results.putMany(
          files.map((file) => result(check(file.path), keyIn(f, root, file), { worktreeId: id })),
        ),
      );
      pending(f, root, files, null);
    };
    const joined = await run(
      f,
      { commit: a, paths: [TEST.path], json: true, waitMs: 5000 },
      { ...options, daemons: daemons.ports },
    );
    expect(joined.code, joined.out).toBe(0);
    expect(daemons.commitAsks).toHaveLength(asked.commit);
    expect(daemons.asks).toHaveLength(asked.now);
    expect(daemons.commits).toHaveLength(commits);
    expect(daemons.started).toHaveLength(started);
    expect(daemons.waits.slice(waits).sort()).toEqual([tree, f.root].sort());
    expect(fileOf(joined.out)).toMatchObject({
      at: { state: "pass", origin: { kind: "commit" } },
      now: { state: "pass", origin: { kind: "own" } },
    });
    expect(JSON.parse(joined.out).run).toMatchObject({
      mode: "join",
      commit: { files: 1, known: 1, running: 0 },
    });
  });

  it("queues nothing in the working tree when the commit daemon selects nothing and the file has a result now", async () => {
    const { f, a, tree } = changed();
    // The commit daemon lists the file with a result at its key, so it selects nothing.
    pending(f, tree, [TEST], null);
    withStore(f, (store) =>
      store.results.putMany([
        result(check(TEST.path), `commit-${TEST.path}`, { worktreeId: worktreeIdFor(tree) }),
        result(check(TEST.path), `daemon-${TEST.path}`, { worktreeId: worktreeIdFor(f.root) }),
      ]),
    );
    const none = standIn(tree, () => undefined, { select: () => [] });
    const install = linkInstall().install;
    const options = { cacheRoot: f.cacheRoot, install, daemons: none.ports };
    const again = await run(f, { commit: a, run: { allMissing: false } }, options);
    expect(again.code, again.out).toBe(0);
    expect(none.asks).toEqual([]);
    expect(none.commitAsks).toHaveLength(1);
    expect(again.out).toContain(
      `--run: no file with no result at ${a.slice(0, 9)} that the change selects to run`,
    );
    expect(again.out).not.toContain("still running");
  });

  it("reads a failed setup in the commit daemon as R3's setup line, never as still running", async () => {
    const { f, a, tree } = changed();
    const failing = standIn(
      tree,
      (root, files) => {
        if (root !== tree) return;
        const setup = { kind: "setup", project: "", testPath: "test/setup.ts" as never } as const;
        withStore(f, (store) =>
          store.knownStates.upsertMany([knownState(worktreeIdFor(tree), setup)]),
        );
        pending(f, tree, files, null);
      },
      { select: () => [TEST], rows: (at, files) => pending(f, at, files, "queued") },
    );
    const install = linkInstall().install;
    const options = { cacheRoot: f.cacheRoot, install, daemons: failing.ports };
    const text = await run(f, { commit: a, run: { allMissing: false }, waitMs: 5000 }, options);
    expect(text.code).toBe(3);
    const at = a.slice(0, 9);
    // The group's name, then the setup's own text, as the in-call run said it (row 023-29, R3).
    expect(text.out).toContain(`${TEST.path}: not run (the batch's setup failed: tests: boom)`);
    expect(text.out).toContain("1 not run: the batch's setup failed (tests: boom)");
    expect(text.out).not.toContain(`still running at ${at}`);
  });
});
