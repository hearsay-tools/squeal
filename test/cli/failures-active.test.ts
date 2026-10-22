import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { FAILURES_LIMIT } from "../../src/core/status/index.js";
import type { openStore as OpenStore } from "../../src/core/store/index.js";
import type {
  CheckId,
  FailureEntry,
  FailuresReport,
  ResultRecord,
  Store,
} from "../../src/core/types/index.js";
import { check, fakeRepo, seedStore } from "../status/helpers.js";
import { result } from "../store/helpers.js";
import { keyTestFiles } from "./failures-keys.js";

/*
 * Row 011-79 (011 C6 and C10 as amended for 011-62, gh-53): `squeal failures`
 * marks a failure whose test file has no key in its own worktree, a deleted
 * file or a project the configuration no longer has: `not a test file here
 * now` in text, `active: false` in `--json`. It still lists and counts it, as
 * history, and looks up only the rows it lists.
 */

/** `test_file_keys` lookups of named files, by every store the command opens. */
const lookups = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../src/core/store/index.js", async (importOriginal) => {
  const original = await importOriginal<{ openStore: typeof OpenStore }>();
  const openStore: typeof OpenStore = (commonDir, options) => {
    const opened = original.openStore(commonDir, options);
    if (!("testFileKeys" in opened)) return opened;
    const store = opened as { -readonly [K in keyof Store]: Store[K] };
    const { testFileKeys } = store;
    store.testFileKeys = {
      ...testFileKeys,
      list: (id, files) => {
        if (files !== undefined) lookups.count++;
        return testFileKeys.list(id, files);
      },
    };
    return store;
  };
  return { ...original, openStore };
});

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const MARK = ", not a test file here now";

function run(argv: string[], cwd: string) {
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    cwd,
    now: () => NOW,
    env: {},
  };
  return { code: main(argv, io), stdout };
}

const json = (argv: string[], cwd: string) =>
  JSON.parse(run([...argv, "--json"], cwd).stdout) as FailuresReport;

const projectCheck = (project: string, path: string): CheckId => ({
  kind: "test",
  project,
  testPath: path,
  fullName: "fails",
});

function fail(c: CheckId, worktreeId: string, minutesAgo: number): ResultRecord {
  return result(c, `${worktreeId}:${c.project}:${c.testPath}:${minutesAgo}`, {
    outcome: "fail",
    worktreeId,
    recordedAt: NOW - minutesAgo * MINUTE,
    runId: `run-${minutesAgo}`,
  });
}

/** `failure` is stored, then a pass in its worktree replaces it at its key a minute later. */
function replace(store: Store, failure: ResultRecord): void {
  store.results.putMany([failure]);
  store.transaction(() => {
    const failing = store.failures.failingAt(failure.key);
    const pass = result(failure.check, failure.key, {
      worktreeId: failure.provenance.worktreeId,
      recordedAt: failure.provenance.recordedAt + MINUTE,
      runId: `pass-of-${failure.provenance.runId}`,
    });
    store.results.putMany([pass]);
    store.failures.keepReplaced(failing, [pass], () => 2.5);
  });
}

/** The main worktree and a linked worktree `b`, both registered in the store. */
function seed() {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const b = repo.addWorktree("b");
  for (const [id, root] of [
    [repo.mainId, repo.main],
    [b.id, b.root],
  ] as const) {
    store.worktrees.upsert({
      id,
      root,
      commonDir: repo.commonDir,
      isMain: id === repo.mainId,
      registeredAt: 1,
      daemon: null,
    });
  }
  return { repo, store, b };
}

/** Each listed failure's `[project] path` and whether it is active. */
const actives = (failures: readonly FailureEntry[]) =>
  failures.map((f) => [`[${f.check.project}] ${f.check.testPath}`, f.active]);

beforeEach(() => {
  lookups.count = 0;
});

describe("squeal failures marks history outside the active configuration (row 011-79)", () => {
  it("marks a deleted file's and a removed project's failures, and not a keyed file's", () => {
    const { repo, store } = seed();
    const kept = fail(projectCheck("keep", "keep/keep.test.mjs"), repo.mainId, 10);
    const deleted = fail(projectCheck("keep", "keep/deleted.test.mjs"), repo.mainId, 20);
    const gone = fail(projectCheck("gone", "gone/gone.test.mjs"), repo.mainId, 30);
    const renamed = fail(projectCheck("gone2", "gone/gone.test.mjs"), repo.mainId, 40);
    store.results.putMany([kept, deleted, gone, renamed]);
    // Every file was listed; then the listing lost `deleted.test.mjs` and the project `gone`,
    // which `gone2` now lists at the same path: the ledger's commit removes their rows.
    keyTestFiles(store, [kept, deleted, gone, renamed]);
    store.testFileKeys.remove(repo.mainId, [
      { project: "keep", path: "keep/deleted.test.mjs" },
      { project: "gone", path: "gone/gone.test.mjs" },
    ]);

    const report = json(["failures"], repo.main);
    expect(report).toMatchObject({ total: 4, replaced: 0 });
    expect(actives(report.failures)).toEqual([
      ["[keep] keep/keep.test.mjs", true],
      ["[keep] keep/deleted.test.mjs", false],
      ["[gone] gone/gone.test.mjs", false],
      ["[gone2] gone/gone.test.mjs", true],
    ]);

    const text = run(["failures"], repo.main).stdout;
    const provenance = text.split("\n").filter((line) => line.includes(", run run-"));
    expect(provenance.map((line) => line.endsWith(MARK))).toEqual([false, true, true, false]);
    expect(text).toContain(
      `        ${repo.main} (this worktree), revision 4, commit abc123, dirty, 12 ms, run run-20${MARK}\n`,
    );
    expect(text).toContain("Failures in this worktree (4 failures, newest first):");
  });

  it("judges each row by its own worktree with --all-worktrees, from any worktree", () => {
    const { repo, store, b } = seed();
    const shared = check("src/shared.test.ts", "adds");
    const inMain = fail(shared, repo.mainId, 5);
    const inB = fail(shared, b.id, 6);
    const inRemoved = fail(shared, "wt-removed", 7);
    store.results.putMany([inMain, inB, inRemoved]);
    // `b` deleted the file; the main worktree still has it.
    keyTestFiles(store, [inMain]);

    for (const cwd of [repo.main, b.root]) {
      const report = json(["failures", "--all-worktrees"], cwd);
      expect(report.failures.map((f) => [f.worktreeId, f.active])).toEqual([
        [repo.mainId, true],
        [b.id, false],
        ["wt-removed", false],
      ]);
    }
    expect(json(["failures"], b.root).failures.map((f) => f.active)).toEqual([false]);
    expect(json(["failures"], repo.main).failures.map((f) => f.active)).toEqual([true]);

    const text = run(["failures", "--all-worktrees"], b.root).stdout;
    expect(text).toContain(
      `        ${repo.main}, revision 4, commit abc123, dirty, 12 ms, run run-5\n`,
    );
    expect(text).toContain(`        ${b.root} (this worktree), revision 4, `);
    expect(text).toContain(`, run run-6${MARK}\n`);
    expect(text).toContain(`        removed worktree wt-removed, revision 4, `);
    expect(text).toContain(`, run run-7${MARK}\n`);
  });

  it("marks a replaced failure of a deleted file", () => {
    const { repo, store } = seed();
    const flaky = fail(check("src/flaky.test.ts", "flips"), repo.mainId, 20);
    replace(store, flaky);

    const report = json(["failures"], repo.main);
    expect(report).toMatchObject({ total: 1, replaced: 1 });
    expect(report.failures[0]).toMatchObject({
      active: false,
      replacedBy: { runId: "pass-of-run-20" },
    });
    expect(run(["failures"], repo.main).stdout).toContain(`, run run-20${MARK}\n`);

    keyTestFiles(store, [flaky]);
    expect(json(["failures"], repo.main).failures[0]?.active).toBe(true);
  });

  it("keeps the cap and the total, and looks up only the listed rows", () => {
    const { repo, store } = seed();
    const many = Array.from({ length: FAILURES_LIMIT + 10 }, (_, i) =>
      fail(check(`src/many-${i}.test.ts`, "case"), repo.mainId, 10 + i),
    );
    store.results.putMany(many);
    // Older than every stored one: merged, counted, and cut from the list.
    for (let i = 0; i < 5; i++) {
      replace(store, fail(check(`src/old-${i}.test.ts`, "case"), repo.mainId, 100 + i));
    }
    // Every other file is still a test file here.
    keyTestFiles(
      store,
      many.filter((_, i) => i % 2 === 0),
    );

    lookups.count = 0;
    const report = json(["failures"], repo.main);
    expect(report).toMatchObject({
      total: FAILURES_LIMIT + 15,
      replaced: 5,
      limit: FAILURES_LIMIT,
    });
    expect(report.failures.map((f) => f.active)).toEqual(
      Array.from({ length: FAILURES_LIMIT }, (_, i) => i % 2 === 0),
    );
    expect(lookups.count).toBe(FAILURES_LIMIT);

    const text = run(["failures"], repo.main).stdout;
    expect(text).toContain(
      `Failures in this worktree (newest ${FAILURES_LIMIT} of ${FAILURES_LIMIT + 15}, 5 replaced, newest first):`,
    );
    expect(text.split("\n").filter((line) => line.endsWith(MARK))).toHaveLength(FAILURES_LIMIT / 2);
  });
});
