import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import type { FailuresReport, ResultRecord, Store } from "../../src/core/types/index.js";
import { check, fakeRepo, seedStore } from "../status/helpers.js";
import { result } from "../store/helpers.js";
import { keyTestFiles } from "./failures-keys.js";

/*
 * 011 C6 as amended 2026-10-21 (row 011-77, gh-54): `squeal failures` lists
 * the replaced failures with the stored ones, marked, merged newest first,
 * selected by the same paths, `--check`, `--error`, `--since` and worktree,
 * counted apart, and cut at `--limit`.
 */

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);

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

function fail(path: string, name: string, minutesAgo: number, worktreeId: string): ResultRecord {
  const r = result(check(path, name), `${path}-${name}-${minutesAgo}`, {
    outcome: "fail",
    worktreeId,
    recordedAt: NOW - minutesAgo * MINUTE,
    runId: `run-${minutesAgo}`,
  });
  return { ...r, summary: `${name} broke`, fingerprint: `${name} broke @ src/a.test.ts:3:5` };
}

/** `failure` is stored, then a pass replaces it at its key, a minute later or `passedMinutesAgo`. */
function replace(store: Store, failure: ResultRecord, by: string, passedMinutesAgo?: number): void {
  store.results.putMany([failure]);
  store.transaction(() => {
    const failing = store.failures.failingAt(failure.key);
    const pass = result(failure.check, failure.key, {
      worktreeId: by,
      recordedAt:
        passedMinutesAgo === undefined
          ? failure.provenance.recordedAt + MINUTE
          : NOW - passedMinutesAgo * MINUTE,
      runId: `pass-of-${failure.provenance.runId}`,
    });
    store.results.putMany([pass]);
    store.failures.keepReplaced(failing, [pass], () => 2.5);
  });
}

/** Stored: `adds` 10 min ago (main), `login` 30 (b). Replaced: `flips` 20 (main, by b), `retries` 40 (b). */
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
  const stored = [
    fail("src/a.test.ts", "adds", 10, repo.mainId),
    fail("src/auth.test.ts", "login", 30, b.id),
  ];
  const replaced = [
    fail("src/flaky.test.ts", "flips", 20, repo.mainId),
    fail("src/auth.test.ts", "retries", 40, b.id),
  ];
  store.results.putMany(stored);
  for (const failure of replaced) replace(store, failure, b.id);
  keyTestFiles(store, [...stored, ...replaced]);
  return { repo, store, b };
}

describe("squeal failures with replaced failures (011-77)", () => {
  it("merges them newest first, marked, with the pass and the load, counted apart", () => {
    const { repo, b } = seed();
    const all = json(["failures", "--all-worktrees"], repo.main);
    expect(all).toMatchObject({ total: 4, replaced: 2 });
    expect(all.failures.map((f) => [f.check.testPath, f.replacedBy?.runId ?? null])).toEqual([
      ["src/a.test.ts", null],
      ["src/flaky.test.ts", "pass-of-run-20"],
      ["src/auth.test.ts", null],
      ["src/auth.test.ts", "pass-of-run-40"],
    ]);
    expect(all.failures[1]).toMatchObject({
      worktreeId: repo.mainId,
      loadPerCpu: 2.5,
      location: { path: "src/a.test.ts", line: 3, column: 5 },
      replacedBy: { worktreeId: b.id, worktreeRoot: b.root, recordedAt: NOW - 19 * MINUTE },
    });

    const text = run(["failures", "--all-worktrees"], repo.main).stdout;
    expect(text).toContain("Failures in every worktree (4 failures, 2 replaced, newest first):");
    expect(text).toContain(
      [
        "  REPLACED  2026-10-22T11:40:00.000Z  src/flaky.test.ts > flips",
        `        ${repo.main} (this worktree), revision 4, commit abc123, dirty, 12 ms, run run-20`,
        `        replaced by PASS 2026-10-22T11:41:00.000Z (${b.root}, run pass-of-run-20), load 2.50 per CPU when it ran`,
        "        at src/a.test.ts:3:5",
        "        flips broke @ src/a.test.ts:3:5",
      ].join("\n"),
    );
  });

  it("selects them by worktree, path, --check, --error and --since, and cuts the merge at --limit", () => {
    const { repo, b } = seed();
    expect(json(["failures"], repo.main)).toMatchObject({ total: 2, replaced: 1 });
    expect(json(["failures"], b.root)).toMatchObject({ total: 2, replaced: 1 });
    const auth = json(["failures", "--all-worktrees", "src/auth.test.ts"], repo.main);
    expect(auth.failures.map((f) => f.check)).toEqual([
      check("src/auth.test.ts", "login"),
      check("src/auth.test.ts", "retries"),
    ]);
    expect(json(["failures", "--all-worktrees", "--check", "flips"], repo.main)).toMatchObject({
      total: 1,
      replaced: 1,
    });
    expect(
      json(["failures", "--all-worktrees", "--error", "retries broke"], repo.main).failures,
    ).toMatchObject([{ check: check("src/auth.test.ts", "retries") }]);
    expect(json(["failures", "--all-worktrees", "--since", "25m"], repo.main)).toMatchObject({
      total: 2,
      replaced: 1,
    });
    const two = json(["failures", "--all-worktrees", "--limit", "2"], repo.main);
    expect(two).toMatchObject({ total: 4, replaced: 2, limit: 2 });
    expect(two.failures.map((f) => f.runId)).toEqual(["run-10", "run-20"]);
  });

  it("with --per-check lists each check once at its newest, stored or replaced", () => {
    const { repo, store } = seed();
    // `flips` also has an older stored failure; its replaced one is newer.
    store.results.putMany([fail("src/flaky.test.ts", "flips", 50, repo.mainId)]);
    const each = json(["failures", "--all-worktrees", "--per-check"], repo.main);
    expect(each).toMatchObject({ total: 4, replaced: 2 });
    expect(each.failures.map((f) => f.runId)).toEqual(["run-10", "run-20", "run-30", "run-40"]);
    // A newer stored failure of `flips` is its newest: no longer counted as replaced.
    store.results.putMany([fail("src/flaky.test.ts", "flips", 5, repo.mainId)]);
    const newer = json(["failures", "--all-worktrees", "--per-check"], repo.main);
    expect(newer).toMatchObject({ total: 4, replaced: 1 });
    expect(newer.failures.map((f) => f.runId)).toEqual(["run-5", "run-10", "run-30", "run-40"]);
  });

  it("orders them by when they failed, not by when a pass replaced them (review 0.1.265 B1)", () => {
    const { repo, store, b } = seed();
    // `swaps` failed at k1 30 min ago and at k2 10 min ago; its stored failure 20 min ago lies
    // between. A retry replaced k2 5 min ago, then another worktree's run replaced k1 2 min ago.
    const swaps = (minutesAgo: number) => fail("src/order.test.ts", "swaps", minutesAgo, b.id);
    replace(store, swaps(10), b.id, 5);
    store.results.putMany([swaps(20)]);
    replace(store, swaps(30), repo.mainId, 2);
    const runs = (argv: string[]) => {
      const report = json(["failures", "--all-worktrees", "--check", "swaps", ...argv], repo.main);
      return [report.total, report.replaced, report.failures.map((f) => f.runId)];
    };
    expect(runs([])).toEqual([3, 2, ["run-10", "run-20", "run-30"]]);
    expect(runs(["--per-check"])).toEqual([1, 1, ["run-10"]]);
    expect(run(["failures", "--all-worktrees", "--per-check"], repo.main).stdout).toContain(
      "  REPLACED  2026-10-22T11:50:00.000Z  src/order.test.ts > swaps",
    );
  });

  it("at one failure time lists the one kept later first, and a stored one before a replaced one", () => {
    const { repo, store, b } = seed();
    const tie = (key: string, runId: string): ResultRecord => {
      const r = fail("src/tie.test.ts", "ties", 15, b.id);
      return { ...r, key, provenance: { ...r.provenance, runId } };
    };
    replace(store, tie("k-first", "kept-first"), b.id, 6);
    replace(store, tie("k-second", "kept-second"), b.id, 8);
    const runs = (argv: string[]) =>
      json(["failures", "--all-worktrees", "--check", "ties", ...argv], repo.main).failures.map(
        (f) => f.runId,
      );
    expect(runs([])).toEqual(["kept-second", "kept-first"]);
    expect(runs(["--per-check"])).toEqual(["kept-second"]);
    store.results.putMany([tie("k-stored", "stored")]);
    expect(runs([])).toEqual(["stored", "kept-second", "kept-first"]);
    const each = json(["failures", "--all-worktrees", "--check", "ties", "--per-check"], repo.main);
    expect([each.total, each.replaced, each.failures.map((f) => f.runId)]).toEqual([
      1,
      0,
      ["stored"],
    ]);
  });
});
