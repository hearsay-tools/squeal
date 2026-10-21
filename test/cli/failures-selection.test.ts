import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import type { ResultRecord } from "../../src/core/types/index.js";
import { check, fakeRepo, seedStore } from "../status/helpers.js";
import { result } from "../store/helpers.js";

/*
 * Row 011-75 (011-64 R1, gh-67): `squeal failures` selects by test file or
 * directory and by check name, with a limit, in the store's query. Before
 * it, a path, `--check` or `--limit` exited 2, and the newest 20 failures
 * overall hid a test file's older ones.
 */

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);

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

function fail(path: string, name: string, worktreeId: string, minutesAgo: number): ResultRecord {
  return result(check(path, name), `${worktreeId}-${path}-${name}-${minutesAgo}`, {
    outcome: "fail",
    worktreeId,
    recordedAt: NOW - minutesAgo * MINUTE,
    runId: `run-${minutesAgo}`,
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

/** The check names of a listing's `FAIL` lines, in order. */
function listed(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("  FAIL"))
    .map((line) => line.split("  ").at(-1) ?? "");
}

describe("squeal failures by test file, directory and check (row 011-75)", () => {
  it("lists a test file's two oldest failures below 30 newer ones (issue 67)", () => {
    const { repo, store, b } = seed();
    store.results.putMany([
      fail("test/harness-autosave.test.ts", "saves after idle", b.id, 120),
      fail("test/harness-autosave.test.ts", "saves on blur", repo.mainId, 110),
      ...Array.from({ length: 30 }, (_, i) =>
        fail(`test/other-${i}.test.ts`, "fails", i % 2 === 0 ? b.id : repo.mainId, i + 1),
      ),
    ]);

    const all = run(["failures", "--all-worktrees"], b.root);
    expect(all.stdout).toContain("(newest 20 of 32, newest first)");
    expect(all.stdout).not.toContain("harness-autosave");

    const out = run(["failures", "--all-worktrees", "test/harness-autosave.test.ts"], b.root);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain(
      "Failures in every worktree for test/harness-autosave.test.ts (2 failures, newest first):",
    );
    expect(listed(out.stdout)).toEqual([
      "test/harness-autosave.test.ts > saves on blur",
      "test/harness-autosave.test.ts > saves after idle",
    ]);
    const json = JSON.parse(
      run(["failures", "--all-worktrees", "--json", "test/harness-autosave.test.ts"], b.root)
        .stdout,
    );
    expect(json).toMatchObject({
      total: 2,
      limit: 20,
      selection: { paths: ["test/harness-autosave.test.ts"], checks: [] },
    });
  });

  it("reads a path from the working directory, a directory as its files, in every worktree", () => {
    const { repo, store, b } = seed();
    store.results.putMany([
      fail("src/auth/login.test.ts", "logs in", b.id, 1),
      fail("src/auth/deep/token.test.ts", "refreshes", repo.mainId, 2),
      fail("src/auth/login.test.ts", "logs in", repo.mainId, 3),
      fail("src/authz.test.ts", "denies", b.id, 4),
      fail("src/Auth/upper.test.ts", "shouts", b.id, 5),
      fail("src/gone.test.ts", "was deleted", b.id, 6),
    ]);
    const sub = join(b.root, "src");
    mkdirSync(sub);

    // A directory selects the files at or below it, never a sibling sharing its prefix.
    const dir = run(["failures", "--all-worktrees", "src/auth"], b.root);
    expect(dir.stdout).toContain("Failures in every worktree for src/auth (3 failures");
    expect(listed(dir.stdout)).toEqual([
      "src/auth/login.test.ts > logs in",
      "src/auth/deep/token.test.ts > refreshes",
      "src/auth/login.test.ts > logs in",
    ]);

    // Typed in `src`, the path is `src/auth/login.test.ts` from the root, in both worktrees.
    const typed = run(["failures", "--all-worktrees", "auth/login.test.ts"], sub);
    expect(typed.stdout).toContain("for src/auth/login.test.ts (2 failures");
    expect(typed.stdout).toContain(`${b.root} (this worktree)`);
    expect(typed.stdout).toContain(`        ${repo.main}, revision 4`);
    // Without --all-worktrees, only this worktree's.
    expect(listed(run(["failures", "auth"], sub).stdout)).toEqual([
      "src/auth/login.test.ts > logs in",
    ]);

    // No file has this path on disk; its stored failure is still listed.
    expect(listed(run(["failures", "gone.test.ts"], sub).stdout)).toEqual([
      "src/gone.test.ts > was deleted",
    ]);

    const outside = run(["failures", "../../elsewhere.test.ts"], sub);
    expect(outside.code).toBe(2);
    expect(outside.stderr).toContain('"../../elsewhere.test.ts" is outside the worktree');
    expect(outside.stdout).toBe("");
  });

  it("selects by a part of the printed check name, and with a path needs both", () => {
    const { repo, store, b } = seed();
    store.results.putMany([
      fail("test/harness-autosave.test.ts", "saves after idle", b.id, 1),
      fail("test/editor.test.ts", "autosave > keeps the draft", repo.mainId, 2),
      fail("test/editor.test.ts", "undo", repo.mainId, 3),
      fail("test/router.test.ts", "routes", b.id, 4),
    ]);

    const part = run(["failures", "--all-worktrees", "--check", "autosave"], b.root);
    expect(part.stdout).toContain('for checks holding "autosave" (2 failures');
    expect(listed(part.stdout)).toEqual([
      "test/harness-autosave.test.ts > saves after idle",
      "test/editor.test.ts > autosave > keeps the draft",
    ]);

    // The exact name a notice prints selects its check.
    const exact = run(
      ["failures", "--all-worktrees", "--check=test/editor.test.ts > undo"],
      b.root,
    );
    expect(listed(exact.stdout)).toEqual(["test/editor.test.ts > undo"]);

    // Several --check: any; with a path: both.
    const any = run(
      ["failures", "--all-worktrees", "--check", "undo", "--check", "routes"],
      b.root,
    );
    expect(listed(any.stdout)).toEqual([
      "test/editor.test.ts > undo",
      "test/router.test.ts > routes",
    ]);
    const both = run(
      ["failures", "--all-worktrees", "test/editor.test.ts", "--check", "autosave"],
      b.root,
    );
    expect(both.stdout).toContain('for test/editor.test.ts, checks holding "autosave" (1 failure');
    expect(listed(both.stdout)).toEqual(["test/editor.test.ts > autosave > keeps the draft"]);

    const none = run(["failures", "--all-worktrees", "--check", "nothing like it"], b.root);
    expect(none.stdout).toBe(
      'No stored failures in every worktree for checks holding "nothing like it".\n',
    );
    expect(run(["failures", "--check"], b.root).code).toBe(2);
    expect(run(["failures", "--check", ""], b.root).code).toBe(2);
  });

  it("lists at most --limit and prints the total; a limit that is not a positive integer exits 2", () => {
    const { repo, store } = seed();
    store.results.putMany(
      Array.from({ length: 60 }, (_, i) => fail(`test/f${i}.test.ts`, "fails", repo.mainId, i + 1)),
    );

    const out = run(["failures", "--limit", "50"], repo.main);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("Failures in this worktree (newest 50 of 60, newest first):");
    expect(listed(out.stdout)).toHaveLength(50);
    const json = JSON.parse(run(["failures", "--limit=50", "--json"], repo.main).stdout);
    expect(json).toMatchObject({ total: 60, limit: 50 });
    expect(json.failures).toHaveLength(50);

    for (const bad of [
      ["--limit", "0"],
      ["--limit", "x"],
      ["--limit", "-1"],
      ["--limit=1.5"],
      ["--limit"],
    ]) {
      const { code, stderr } = run(["failures", ...bad], repo.main);
      expect(code).toBe(2);
      expect(stderr).toContain("--limit takes a positive whole number");
    }
  });
});
