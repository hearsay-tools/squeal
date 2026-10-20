import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import {
  type NamedWaitOptions,
  namedCode,
  selectNamedFiles,
  waitForNamed,
} from "../../src/cli/status-wait-paths.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import { withStatusStore } from "../../src/core/status/index.js";
import type { CheckKey, RevisionNumber, Store } from "../../src/core/types/index.js";
import { appendRevisions } from "../status/helpers.js";
import {
  A,
  ADDS,
  B,
  C,
  fail,
  finish,
  key,
  later,
  NOW,
  ref,
  repoWith,
  timed,
} from "./status-wait-fixture.js";

/*
 * Spec 005 D2: "`squeal status --wait <ms> <path>...` restricts the wait's
 * file set. A test-file path selects itself. Any other path selects the test
 * files whose closure holds it, using the stored closure only when it is
 * valid for the file's current key (001 D6's rule). A path that selects
 * nothing exits 3 with `no test file's closure holds <path>`." It exits as
 * D1 for those files only.
 */

const SHARED = "src/shared.ts";

/** `testFile`'s stored closure, written by `by`. */
function closure(store: Store, testFile: string, paths: readonly string[], by: string) {
  store.testFiles.put({
    testFile: ref(testFile),
    closure: {
      testFile: ref(testFile),
      paths: [testFile, ...paths].sort() as never,
      complete: false,
      method: CLOSURE_METHOD,
    },
    updatedAt: NOW,
    updatedBy: by,
  });
}

function select(root: string, paths: readonly string[], cwd = root) {
  const read = withStatusStore(root, {}, ({ store, root: found }) =>
    selectNamedFiles(store, worktreeIdFor(found), found, cwd, paths),
  );
  if ("available" in read) throw new Error(read.message);
  return { files: read.files.map((f) => f.path), unmatched: read.unmatched };
}

const synced = (revision = 4): SyncState => ({
  state: "synced",
  revision: revision as RevisionNumber,
  incarnation: null,
});

function stub(state: () => SyncState) {
  return (): DaemonSync => ({ current: state, stop: () => {} });
}

function options(sync: () => SyncState, timeoutMs = 5_000): NamedWaitOptions {
  return { timeoutMs, pollMs: 20, settleMs: 100, now: () => NOW, sync: stub(sync) };
}

async function run(argv: string[], cwd: string) {
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
  const code = await main(argv, io);
  return { code, stdout, stderr };
}

describe("selectNamedFiles", () => {
  it("selects a test file by its own path, resolved against the working directory", () => {
    const { repo } = repoWith([], [A, B]);
    expect(select(repo.main, [A])).toEqual({ files: [A], unmatched: [] });
    mkdirSync(join(repo.main, "src"));
    expect(select(repo.main, ["b.test.ts"], join(repo.main, "src"))).toEqual({
      files: [B],
      unmatched: [],
    });
  });

  it("selects every test file whose own stored closure holds a source path", () => {
    const { repo, store } = repoWith([], [A, B, C]);
    closure(store, A, [SHARED, "src/a.ts"], repo.mainId);
    closure(store, B, [SHARED], repo.mainId);
    closure(store, C, ["src/c.ts"], repo.mainId);
    expect(select(repo.main, [SHARED])).toEqual({ files: [A, B], unmatched: [] });
    expect(select(repo.main, ["src/a.ts", "src/c.ts"])).toEqual({ files: [A, C], unmatched: [] });
  });

  it("uses another worktree's closure only while its key for the file is this worktree's", () => {
    const { repo, store } = repoWith([], [A, B]);
    const other = repo.addWorktree("other");
    // Same key as this worktree's: the closure covers the same files and content.
    key(store, other.id, A, null);
    closure(store, A, [SHARED], other.id);
    // A different key: the other branch may import other files.
    store.testFileKeys.upsertMany([
      {
        worktreeId: other.id,
        testFile: ref(B),
        key: "another-key" as CheckKey,
        revision: 4 as RevisionNumber,
        pending: null,
      },
    ]);
    closure(store, B, ["src/b.ts"], other.id);
    expect(select(repo.main, [SHARED])).toEqual({ files: [A], unmatched: [] });
    expect(select(repo.main, ["src/b.ts"])).toEqual({ files: [], unmatched: ["src/b.ts"] });
  });

  it("names each path that selects nothing, a path outside the worktree as given", () => {
    const { repo, store } = repoWith([], [A]);
    closure(store, A, [SHARED], repo.mainId);
    expect(select(repo.main, ["src/none.ts", A, "/elsewhere/x.ts"])).toEqual({
      files: [A],
      unmatched: ["src/none.ts", "/elsewhere/x.ts"],
    });
  });
});

describe("waitForNamed", () => {
  it("returns when the named pending file's result lands, while another stays pending", async () => {
    const { repo, store } = repoWith([A, B]);
    const finished = later(300, () => finish(store, repo.mainId, A));
    const named = options(() => synced());
    const { wait, endedBy } = await timed(() => waitForNamed(repo.main, [A], named));
    if (wait.outcome === "unavailable") throw new Error("unavailable");
    expect(wait.outcome).toBe("settled");
    expect(endedBy).toBeGreaterThanOrEqual(finished.at);
    expect(wait.result.counts.pending).toBeGreaterThan(0);
    expect(namedCode(wait)).toBe(0);
  });

  it("exits 1 when a selected file has a known failure, whatever other files hold", async () => {
    const { repo, store } = repoWith([B], [A]);
    fail(store, repo.mainId, ADDS);
    const wait = await waitForNamed(
      repo.main,
      [A],
      options(() => synced()),
    );
    if (wait.outcome === "unavailable") throw new Error("unavailable");
    expect([wait.outcome, namedCode(wait)]).toEqual(["settled", 1]);
    expect(wait.verdict.failures).toEqual({ tests: 1, testFiles: 0 });
  });

  it("has no verdict, 3, for an unkeyed selected file, at the deadline and without a daemon", async () => {
    const unkeyed = repoWith([], [A]);
    unkeyed.store.testFileKeys.upsertMany([
      {
        worktreeId: unkeyed.repo.mainId,
        testFile: ref(C),
        key: null,
        revision: 4 as RevisionNumber,
        pending: null,
      },
    ]);
    const unknown = await waitForNamed(
      unkeyed.repo.main,
      [A, C],
      options(() => synced()),
    );
    if (unknown.outcome === "unavailable") throw new Error("unavailable");
    expect([unknown.outcome, namedCode(unknown), unknown.verdict.byClass.unknown]).toEqual([
      "settled",
      3,
      1,
    ]);

    const pending = repoWith([A]);
    const timeout = await waitForNamed(
      pending.repo.main,
      [A],
      options(() => synced(), 300),
    );
    if (timeout.outcome === "unavailable") throw new Error("unavailable");
    expect([timeout.outcome, namedCode(timeout)]).toEqual(["timeout", 3]);

    const gone = repoWith([], [A]);
    const row = gone.store.worktrees.get(gone.repo.mainId);
    if (row === null) throw new Error("no worktree");
    gone.store.worktrees.upsert({ ...row, daemon: null });
    const none = await waitForNamed(
      gone.repo.main,
      [A],
      options(() => ({ state: "unsupported" })),
    );
    if (none.outcome === "unavailable") throw new Error("unavailable");
    expect([none.outcome, namedCode(none)]).toEqual(["no-daemon", 3]);
  });

  it("selects after the daemon's pass, so a test file listed after the wait started is found", async () => {
    const { repo, store } = repoWith([], [A]);
    let state: SyncState = { state: "pending" };
    later(200, () => {
      appendRevisions(store, repo.mainId, 1, { head: null, dirty: false });
      finish(store, repo.mainId, C);
      state = synced(5);
    });
    const wait = await waitForNamed(
      repo.main,
      [C],
      options(() => state),
    );
    if (wait.outcome === "unavailable") throw new Error("unavailable");
    expect(wait.outcome).toBe("settled");
    expect(wait.selection.files.map((f) => f.path)).toEqual([C]);
  });
});

describe("squeal status --wait <ms> <path>...", () => {
  // Row 011-28 (005 D2 as amended 2026-10-20, gh-44's E1): the revision line, the selection, last
  // the verdict (issue 26); the worktree's status only with --full.
  it("prints the revision, the selection and last their verdict, 3 lines, and exits 0", async () => {
    const { repo } = repoWith([B], [A]);
    const result = await run(["status", "--wait", "3000", A], repo.main);
    expect(result.code).toBe(0);
    expect(result.stdout.split("\n")).toEqual([
      "Revision: 4",
      `Selected: ${A}`,
      expect.stringMatching(
        /^Named test files at revision 4: no known failures; 1 test file, each with a current result, after \d+\.\d s\. Worktree: known failures 0; not current: 1 of 2 test files \(1 queued\), 1 test \(1 queued\)$/,
      ),
      "",
    ]);
  });

  it("prints the worktree's status before the selection with --full, as before 011-28", async () => {
    const { repo } = repoWith([B], [A]);
    const result = await run(["status", "--wait", "3000", "--full", A], repo.main);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^Revision: 4\nKnown failures: 0; [^\n]*\nAffected checks: /);
    // Review of cand/0.1.234: `--full` is the full status, its detail block included (row 011-29).
    expect(result.stdout).toMatch(/\nWorktree: [^\n]*\nDaemon: [^\n]*\n/);
    expect(result.stdout).toContain("\nClosure method: ");
    expect(result.stdout).not.toContain("\nMore: ");
    const [blank, selected, verdict, end] = result.stdout.split("\n").slice(-4);
    expect([blank, selected, end]).toEqual(["", `Selected: ${A}`, ""]);
    expect(verdict).toMatch(/^Named test files at revision 4: no known failures; /);
  });

  it("lists a selected failure in full and exits 1; --json carries the verdict", async () => {
    const { repo, store } = repoWith([], [A, B]);
    fail(store, repo.mainId, ADDS);
    const human = await run(["status", "--wait", "3000", A], repo.main);
    expect(human.code).toBe(1);
    const lines = human.stdout.trimEnd().split("\n");
    const tail = lines.slice(lines.lastIndexOf(`Selected: ${A}`));
    expect(tail[1]).toBe(`  FAIL  ${A} > adds`);
    expect(tail.at(-1)).toMatch(
      /^Named test files at revision 4: 1 known failure: 1 test; [^\n]*\. Worktree: known failures 1 \(1 test\); /,
    );

    const json = await run(["status", "--json", "--wait", "3000", A], repo.main);
    expect(json.code).toBe(1);
    const payload = JSON.parse(json.stdout);
    expect(payload.wait).toMatchObject({ outcome: "settled", code: 1, unmatched: [] });
    expect(payload.wait.testFiles).toEqual([{ ...ref(A), state: "current", verdict: "fail" }]);
    expect(json.stderr).toMatch(
      new RegExp(`^Selected: ${A}\\nNamed test files at revision 4: 1 known failure[^\\n]*\\n$`),
    );
  });

  it("exits 3 with D2's text for a path that selects nothing", async () => {
    const { repo } = repoWith([], [A]);
    const result = await run(["status", "--wait", "3000", "src/none.ts"], repo.main);
    expect(result.code).toBe(3);
    expect(result.stdout.trimEnd().split("\n").at(-1)).toMatch(
      /^No verdict: no test file's closure holds src\/none\.ts\. Worktree: /,
    );
    expect(result.stdout).not.toContain("Selected:");
  });

  // Design 011-24 section 1.5: `--wait 0` is a wait whose deadline passed, not the snapshot. Its
  // first read is final, so it returns before it promotes, as it always has (the coordinator's
  // correction of the 011-28 brief, `tasks/011-28/notes.md`).
  it("words --wait 0 as a wait whose deadline passed, its payload under `wait`, and promotes nothing", async () => {
    const { repo } = repoWith([A]);
    const promoted: string[][] = [];
    const zero = await waitForNamed(repo.main, [A], {
      ...options(() => synced(), 0),
      promote: (_root, files) => promoted.push(files.map((f) => f.path)),
    });
    expect([zero.outcome, promoted]).toEqual(["timeout", []]);

    const human = await run(["status", "--wait", "0", A], repo.main);
    expect(human.code).toBe(3);
    expect(human.stdout.trimEnd().split("\n").at(-1)).toMatch(
      /^Named test files have no verdict: the deadline passed after 0\.\d s: /,
    );
    const json = await run(["status", "--json", "--wait", "0", A], repo.main);
    const payload = JSON.parse(json.stdout);
    expect(payload.wait).toMatchObject({ outcome: "timeout", code: 3 });
    expect(payload.named).toBeUndefined();
  });
});
