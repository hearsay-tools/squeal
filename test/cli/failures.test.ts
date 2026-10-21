import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { durationMs } from "../../src/cli/failures.js";
import { type CliIo, main } from "../../src/cli/main.js";
import { FAILURES_LIMIT } from "../../src/core/status/index.js";
import type { ResultRecord } from "../../src/core/types/index.js";
import { check, fakeRepo, seedStore } from "../status/helpers.js";
import { result } from "../store/helpers.js";

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);

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

function fail(
  path: string,
  name: string,
  worktreeId: string,
  minutesAgo: number,
  extra: Partial<ResultRecord> = {},
): ResultRecord {
  const r = result(check(path, name), `${worktreeId}-${name}-${minutesAgo}`, {
    outcome: "fail",
    worktreeId,
    recordedAt: NOW - minutesAgo * MINUTE,
    runId: `run-${minutesAgo}`,
  });
  return { ...r, ...extra };
}

/**
 * The main worktree failed `adds` 10 minutes ago and passed `subtracts`;
 * worktree `b` failed `login` 5 minutes ago and `logout` three hours ago.
 */
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
  store.results.putMany([
    fail("src/a.test.ts", "adds", repo.mainId, 10, { durationMs: 33.6 }),
    result(check("src/a.test.ts", "subtracts"), "pass-k", {
      worktreeId: repo.mainId,
      recordedAt: NOW - MINUTE,
    }),
    fail("src/auth.test.ts", "auth > login", b.id, 5),
    fail("src/auth.test.ts", "auth > logout", b.id, 180),
  ]);
  return { repo, store, b };
}

describe("squeal failures (task 001-409)", () => {
  it("lists this worktree's failures, and with --all-worktrees every worktree's, newest first", () => {
    const { repo, b } = seed();

    const own = run(["failures"], b.root);
    expect(own.code).toBe(0);
    expect(own.stdout.replaceAll(b.root, "<b>")).toBe(
      [
        "Failures in this worktree (2 failures, newest first):",
        "  FAIL  2026-10-15T11:55:00.000Z  src/auth.test.ts > auth > login",
        "        <b> (this worktree), revision 4, commit abc123, dirty, 12 ms, run run-5",
        "        AssertionError: expected 1 to be 2 @ src/a.test.ts:3:5",
        "  FAIL  2026-10-15T09:00:00.000Z  src/auth.test.ts > auth > logout",
        "        <b> (this worktree), revision 4, commit abc123, dirty, 12 ms, run run-180",
        "        AssertionError: expected 1 to be 2 @ src/a.test.ts:3:5",
        "",
        'squeal why "<check>" prints a failure\'s full output.',
        "",
      ].join("\n"),
    );

    const all = run(["failures", "--all-worktrees"], b.root);
    expect(all.code).toBe(0);
    const heads = all.stdout.split("\n").filter((line) => line.startsWith("  FAIL"));
    expect(heads.map((line) => line.split("  ").at(-1))).toEqual([
      "src/auth.test.ts > auth > login",
      "src/a.test.ts > adds",
      "src/auth.test.ts > auth > logout",
    ]);
    expect(all.stdout).toContain("Failures in every worktree (3 failures, newest first):");
    expect(all.stdout).toContain(
      `        ${repo.main}, revision 4, commit abc123, dirty, 34 ms, run run-10\n`,
    );
  });

  it("keeps only failures recorded within --since", () => {
    const { b } = seed();

    const recent = run(["failures", "--all-worktrees", "--since", "1h"], b.root);
    expect(recent.stdout).toContain(
      "Failures in every worktree since 2026-10-15T11:00:00.000Z (2 failures, newest first):",
    );
    expect(recent.stdout).not.toContain("auth > logout");

    const none = run(["failures", "--since=2m"], b.root);
    expect(none).toMatchObject({
      code: 0,
      stdout: "No stored failures in this worktree since 2026-10-15T11:58:00.000Z.\n",
    });
  });

  it("caps the list and says how many there are in all", () => {
    const { repo, store } = seed();
    store.results.putMany(
      Array.from({ length: FAILURES_LIMIT + 5 }, (_, i) =>
        fail("src/many.test.ts", `case ${i}`, repo.mainId, 20 + i),
      ),
    );

    const text = run(["failures"], repo.main).stdout;
    expect(text).toContain(
      `Failures in this worktree (newest ${FAILURES_LIMIT} of ${FAILURES_LIMIT + 6}, newest first):`,
    );
    expect(text.split("\n").filter((line) => line.startsWith("  FAIL"))).toHaveLength(
      FAILURES_LIMIT,
    );

    const json = JSON.parse(run(["failures", "--json"], repo.main).stdout);
    expect(json).toMatchObject({ total: FAILURES_LIMIT + 6, limit: FAILURES_LIMIT });
    expect(json.failures).toHaveLength(FAILURES_LIMIT);
    // Newest first: `adds` at 10 minutes, then `case 0` at 20.
    expect(json.failures[0].check.fullName).toBe("adds");
    expect(json.failures[1].check.fullName).toBe("case 0");
  });

  it("prints the --json schema", () => {
    const { repo, b } = seed();

    const { code, stdout } = run(
      ["failures", "--json", "--all-worktrees", "--since", "1h"],
      b.root,
    );

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      schemaVersion: 1,
      available: true,
      worktreeId: b.id,
      worktreeRoot: b.root,
      allWorktrees: true,
      since: NOW - 60 * MINUTE,
      selection: { paths: [], checks: [] },
      total: 2,
      limit: FAILURES_LIMIT,
      failures: [
        {
          check: check("src/auth.test.ts", "auth > login"),
          worktreeId: b.id,
          worktreeRoot: b.root,
          revision: 4,
          commit: "abc123",
          dirty: true,
          recordedAt: NOW - 5 * MINUTE,
          durationMs: 12,
          fingerprint: "AssertionError: expected 1 to be 2 @ src/a.test.ts:3:5",
          summary: "expected 1 to be 2",
          runId: "run-5",
        },
        {
          check: check("src/a.test.ts", "adds"),
          worktreeId: repo.mainId,
          worktreeRoot: repo.main,
          revision: 4,
          commit: "abc123",
          dirty: true,
          recordedAt: NOW - 10 * MINUTE,
          durationMs: 33.6,
          fingerprint: "AssertionError: expected 1 to be 2 @ src/a.test.ts:3:5",
          summary: "expected 1 to be 2",
          runId: "run-10",
        },
      ],
    });
  });

  it("names a removed worktree's failure by its id", () => {
    const { store, b } = seed();
    store.results.putMany([fail("src/gone.test.ts", "gone", "wt-gone", 1)]);

    const text = run(["failures", "--all-worktrees"], b.root).stdout;
    expect(text).toContain("        removed worktree wt-gone, revision 4");
  });

  it("answers without a store by exiting 1 and creates none", () => {
    const repo = fakeRepo();

    const { code, stdout } = run(["failures"], repo.main);

    expect(code).toBe(1);
    expect(stdout).toMatch(/^Status unavailable, no Squeal store at /);
    expect(existsSync(join(repo.commonDir, "squeal", "store.sqlite"))).toBe(false);
  });

  it("rejects an unknown option or a malformed duration with exit 2", () => {
    const { b } = seed();

    expect(run(["failures", "--worktree"], b.root)).toMatchObject({ code: 2 });
    const bad = run(["failures", "--since", "yesterday"], b.root);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain(
      '--since takes a duration such as 90s, 30m, 2h or 1d, not "yesterday"',
    );
    expect(run(["failures", "--since"], b.root)).toMatchObject({ code: 2 });
  });

  it("reads durations in seconds, minutes, hours and days", () => {
    expect(["90s", "30m", "2h", "1d", "10", "1w", "-1h"].map(durationMs)).toEqual([
      90_000,
      30 * MINUTE,
      120 * MINUTE,
      1_440 * MINUTE,
      null,
      null,
      null,
    ]);
  });

  it("is in the help", () => {
    expect(run(["--help"], fakeRepo().main).stdout).toContain(
      "squeal failures [<test file or directory>...] [--check <text>]... [--limit <n>]\n" +
        "                  [--all-worktrees] [--since <duration>] [--json]\n",
    );
  });
});
