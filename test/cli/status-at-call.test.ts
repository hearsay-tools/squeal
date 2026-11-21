import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AtDaemons, NarrowCall } from "../../src/cli/status-at-daemons.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath, RelativePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { liveDaemon } from "./status-at-daemon.js";
import { check, run, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-40a (spec 023 D7.3, research `run-wait-model.md` Q7) on a `$TMPDIR`
 * git fixture with the real keying and stand-in daemons: `--run` queues the
 * selected file in the commit daemon and in this worktree's daemon, one
 * request per group with the named file leading; a call whose wait ends
 * with work still running exits 3 with Q7's line; `--wait` without `--run`
 * joins and queues nothing; the later call reads what the daemons stored,
 * at the commit's keys.
 */

const TEST = ref("test/a.test.ts");

interface Ask {
  readonly root: string;
  readonly group: string;
  readonly paths: readonly RelativePath[];
  readonly call: NarrowCall;
}

/** Stand-in daemons: each records what it is asked; `onWait` plays what the daemon did meanwhile. */
function daemons(
  tree: AbsolutePath,
  onWait: (root: string, files: readonly TestFileRef[]) => void,
) {
  const asks: Ask[] = [];
  const commits: string[] = [];
  const started: string[] = [];
  const waits: string[] = [];
  const ports: AtDaemons = {
    async commit(input) {
      commits.push(input.commit);
      return tree;
    },
    find: () => tree,
    async worktree(root) {
      started.push(root);
      return null;
    },
    async ask(root, group, paths, _deadline, call) {
      asks.push({ root, group, paths, call });
      return "taken";
    },
    async wait(root, files) {
      waits.push(root);
      onWait(root, files);
      return null;
    },
  };
  return { ports, asks, commits, started, waits };
}

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
  const tree = join(f.dir, "commit-tree");
  mkdirSync(tree);
  return { f, a, tree: realpathSync(tree) as AbsolutePath };
}

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
        key: `daemon-${testFile.path}`,
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

describe("status --at --run on the daemons (row 023-40, D7.3)", SLOW, () => {
  it("exits 3 with Q7's line while work runs; --wait joins it, queues nothing, and reads what was stored", async () => {
    const { f, a, tree } = changed();
    const running = daemons(tree, (root, files) =>
      pending(f, root, files, root === tree ? "running" : "queued"),
    );
    const install = linkInstall().install;
    const options = { cacheRoot: f.cacheRoot, install, daemons: running.ports };
    const args = { commit: a, paths: [TEST.path], run: { allMissing: false } };

    const json = await run(f, { ...args, json: true }, options);
    expect(json.code).toBe(3);
    expect(running.commits).toEqual([a]);
    // One request to each daemon, the named file leading; the worktree's daemon was ensured.
    expect(running.asks.map((ask) => [ask.root, ask.paths, ask.call.lead])).toEqual([
      [tree, [TEST.path], true],
      [f.root, [TEST.path], true],
    ]);
    expect(running.started).toEqual([f.root]);
    expect(fileOf(json.out)).toMatchObject({
      at: { state: "no result", pending: "running" },
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
    const key = fileOf(json.out)?.at.key as string;

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
    const asked = running.asks.length;
    const ending = daemons(tree, (root, files) => {
      const own = worktreeIdFor(f.root);
      withStore(f, (store) =>
        store.results.putMany(
          files.map((file) =>
            root === tree
              ? result(check(file.path), key, { worktreeId: worktreeIdFor(tree) })
              : result(check(file.path), `daemon-${file.path}`, { worktreeId: own }),
          ),
        ),
      );
      pending(f, root, files, null);
    });
    const joined = await run(
      f,
      { commit: a, paths: [TEST.path], json: true, waitMs: 5000 },
      { ...options, daemons: ending.ports },
    );
    expect(joined.code).toBe(0);
    expect(ending.asks).toEqual([]);
    expect(ending.commits).toEqual([]);
    expect(ending.started).toEqual([]);
    expect(ending.waits.sort()).toEqual([tree, f.root].sort());
    expect(running.asks).toHaveLength(asked);
    expect(fileOf(joined.out)).toMatchObject({
      at: { state: "pass", origin: { kind: "commit" } },
      now: { state: "pass", origin: { kind: "own" } },
    });
    expect(JSON.parse(joined.out).run).toMatchObject({
      mode: "join",
      commit: { files: 1, known: 1, running: 0 },
    });
  });

  it("queues nothing when the selected file has a result on both sides", async () => {
    const { f, a, tree } = changed();
    const none = daemons(tree, () => undefined);
    const install = linkInstall().install;
    const options = { cacheRoot: f.cacheRoot, install, daemons: none.ports };
    const first = await run(f, { commit: a, json: true }, options);
    const key = fileOf(first.out)?.at.key as string;
    withStore(f, (store) =>
      store.results.putMany([
        result(check(TEST.path), key),
        result(check(TEST.path), `daemon-${TEST.path}`, { worktreeId: worktreeIdFor(f.root) }),
      ]),
    );
    const again = await run(f, { commit: a, run: { allMissing: false } }, options);
    expect(again.code).toBe(0);
    expect(none.asks).toEqual([]);
    expect(none.commits).toEqual([]);
    expect(again.out).toContain(
      `--run: no file with no result at ${a.slice(0, 9)} that the change selects to run`,
    );
    expect(again.out).not.toContain("still running");
  });
});
