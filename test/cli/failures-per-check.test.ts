import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import type { ResultRecord } from "../../src/core/types/index.js";
import { check, fakeRepo, seedStore } from "../status/helpers.js";
import { result } from "../store/helpers.js";

/*
 * Review 0.1.262 B1: the one command a grouped notice prints (row 011-109)
 * must list each check of its group among other failures in its files and
 * every older failure of its checks. `--error` selects by summary,
 * `--per-check` lists each check once, at its newest selected failure, and
 * `--limit all` lists the whole selection.
 */

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);

function run(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    now: () => NOW,
    env: {},
  };
  const code = main(argv, io);
  return { code, stdout, stderr };
}

function fail(name: string, minutesAgo: number, summary: string, worktreeId: string): ResultRecord {
  const c = check("test/view.test.ts", name);
  const base = result(c, `${name}-${minutesAgo}`, {
    outcome: "fail",
    worktreeId,
    recordedAt: NOW - minutesAgo * MINUTE,
    runId: `run-${minutesAgo}`,
  });
  return { ...base, summary, fingerprint: `${summary} @ src/view.ts:1:1` };
}

/** Each of 30 checks failed three times with one error; a newer one failed with another. */
function seed() {
  const repo = fakeRepo();
  const store = seedStore(repo);
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  store.results.putMany([
    ...Array.from({ length: 30 }, (_, i) =>
      [10, 20, 30].map((age) =>
        fail(`renders ${i}`, age + i / 100, "TypeError: x is null", repo.mainId),
      ),
    ).flat(),
    fail("fetches", 1, "Error: fetch failed", repo.mainId),
  ]);
  return repo;
}

/** The check names of a listing's `FAIL` lines, in order. */
function listed(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("  FAIL"))
    .map((line) => line.split("  ").at(-1) ?? "");
}

describe("squeal failures --error, --per-check and --limit all (review 0.1.262 B1)", () => {
  it("selects the failures whose summary holds an --error text", () => {
    const repo = seed();
    const out = run(["failures", "--error", "x is null", "--limit", "200"], repo.main);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain(
      'Failures in this worktree for errors holding "x is null" (90 failures, newest first):',
    );
    expect(listed(out.stdout)).not.toContain("test/view.test.ts > fetches");

    const either = run(["failures", "--error=x is null", "--error", "fetch"], repo.main);
    expect(either.stdout).toContain(
      'for errors holding "x is null" or "fetch" (newest 20 of 91, newest first):',
    );
    expect(listed(either.stdout)[0]).toBe("test/view.test.ts > fetches");
    // Matched as typed, as --check matches a name.
    expect(run(["failures", "--error", "X IS NULL"], repo.main).stdout).toContain(
      "No stored failures in this worktree",
    );
  });

  it("lists each check once with --per-check, at its newest failure, and all of them with --limit all", () => {
    const repo = seed();
    const each = run(["failures", "test", "--error", "x is null", "--per-check"], repo.main);
    expect(each.stdout).toContain(
      'Failures in this worktree for test, errors holding "x is null" (newest 20 of 30 checks, newest failure of each, newest first):',
    );

    const all = run(
      ["failures", "test", "--error", "x is null", "--per-check", "--limit", "all"],
      repo.main,
    );
    expect(all.code).toBe(0);
    expect(all.stdout).toContain("(30 checks, newest failure of each, newest first):");
    const names = listed(all.stdout);
    expect(names).toHaveLength(30);
    expect(new Set(names)).toEqual(
      new Set(Array.from({ length: 30 }, (_, i) => `test/view.test.ts > renders ${i}`)),
    );
    // The newest failure of each: ten minutes old, in run-10.xx.
    expect(all.stdout.match(/, run run-10(\.\d+)?\n/g)).toHaveLength(30);

    const json = JSON.parse(
      run(["failures", "--per-check", "--limit=all", "--error", "x is null", "--json"], repo.main)
        .stdout,
    );
    expect(json).toMatchObject({
      total: 30,
      limit: 30,
      selection: { paths: [], checks: [], errors: ["x is null"], perCheck: true },
    });
    expect(json.failures).toHaveLength(30);

    // Without a selection, --limit all lists every stored failure.
    const every = run(["failures", "--limit", "all"], repo.main);
    expect(every.stdout).toContain("(91 failures, newest first):");
    expect(listed(every.stdout)).toHaveLength(91);
  });

  it("exits 2 for an empty --error, and names all where --limit takes a number", () => {
    const repo = seed();
    expect(run(["failures", "--error"], repo.main).code).toBe(2);
    const empty = run(["failures", "--error", ""], repo.main);
    expect(empty.code).toBe(2);
    expect(empty.stderr).toContain("--error takes a part of an error");
    const bad = run(["failures", "--limit", "every"], repo.main);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain(
      '--limit takes a positive whole number such as 50, or all, not "every"',
    );
    expect(bad.stderr).toContain("[--per-check] [--limit <n>|all]");
  });
});
