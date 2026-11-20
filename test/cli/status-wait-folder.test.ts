import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { printNamed } from "../../src/cli/named-print.js";
import { readNamedSnapshot } from "../../src/cli/status-paths.js";
import type { DaemonSync } from "../../src/cli/status-sync.js";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { type NamedWaitOptions, namedCode, waitForNamed } from "../../src/cli/status-wait-paths.js";
import { recordRefinedApplied } from "../../src/core/scheduler/refined.js";
import type { AbsolutePath, RevisionNumber } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { A, B, finish, NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-406 (gh-169, research `issue-169.md`): a real folder selects the
 * listed test files under it (`.` or the root: all), and only them; they are
 * not promoted. A path that is neither a file nor a folder stays unmatched,
 * and names the listed test files whose path starts with it.
 */

const sync =
  (revision = 4) =>
  (): DaemonSync => ({
    current: () => ({ state: "synced", revision: revision as RevisionNumber, incarnation: null }),
    stop: () => {},
  });

function options(promoted: TestFileRef[][] = [], timeoutMs = 5_000): NamedWaitOptions {
  return {
    timeoutMs,
    pollMs: 20,
    settleMs: 100,
    now: () => NOW,
    sync: sync(),
    promote: (_root, files) => promoted.push([...files]),
  };
}

/** A worktree with A and B current under `src/`, which is a real folder, and an empty `empty/`. */
function current() {
  const made = repoWith([], [A, B]);
  mkdirSync(join(made.repo.main, "src"));
  mkdirSync(join(made.repo.main, "empty"));
  return made;
}

async function snapshot(cwd: string, paths: readonly string[]) {
  const read = await readNamedSnapshot(cwd as AbsolutePath, paths, {
    now: () => NOW,
    sync: sync(),
  });
  if (read.outcome === "unavailable") throw new Error("unavailable");
  return read;
}

async function wait(cwd: string, paths: readonly string[], opts: NamedWaitOptions) {
  const read = await waitForNamed(cwd as AbsolutePath, paths, opts);
  if (read.outcome === "unavailable") throw new Error("unavailable");
  return read;
}

/** `printNamed --json`'s `selection` payload. */
async function printed(read: Awaited<ReturnType<typeof wait>>) {
  let out = "";
  const io = { stdout: (t: string) => (out += t), stderr: () => {}, env: {} };
  await printNamed(Promise.resolve(read), { json: true }, io, () => NOW);
  return JSON.parse(out).selection;
}

const DIRECTORY = "Directory: src; it selects the 2 listed test files under it";

describe("a folder selects the listed test files under it (011-406)", () => {
  it("snapshot: both files under src, one directory line, exit 0", async () => {
    const { repo } = current();

    const read = await snapshot(repo.main, ["src"]);

    expect(read.selection.files).toEqual([ref(A), ref(B)]);
    expect(read.selection.paths).toEqual([{ path: "src", kind: "directory", selects: 2 }]);
    expect(read.selection.unmatched).toEqual([]);
    expect(namedText(read, NOW)).toContain(`${DIRECTORY}\n`);
    expect(namedCode(read)).toBe(0);
    expect((await printed(read)).paths).toEqual([{ path: "src", kind: "directory", selects: 2 }]);
  });

  it("wait: holds for the folder's files and promotes none of them", async () => {
    const { repo, store } = repoWith([A], [B]);
    mkdirSync(join(repo.main, "src"));
    const promoted: TestFileRef[][] = [];
    setTimeout(() => finish(store, repo.mainId, A), 200);

    const read = await wait(repo.main, ["src"], options(promoted));

    expect([read.outcome, namedCode(read)]).toEqual(["settled", 0]);
    expect(read.selection.files).toEqual([ref(A), ref(B)]);
    expect(promoted).toEqual([[]]);
  });

  it("the root, as `.` from the root or as the root from below it, selects every listed file", async () => {
    const { repo } = current();

    for (const [cwd, path] of [
      [repo.main, "."],
      [join(repo.main, "src"), ".."],
      [repo.main, repo.main],
    ] as const) {
      const read = await snapshot(cwd, [path]);
      expect(read.selection.files, path).toEqual([ref(A), ref(B)]);
      expect(read.selection.paths, path).toEqual([{ path: ".", kind: "directory", selects: 2 }]);
    }
  });

  it("`.` below the root is that folder", async () => {
    const { repo } = current();

    const read = await snapshot(join(repo.main, "src"), ["."]);

    expect(read.selection.paths).toEqual([{ path: "src", kind: "directory", selects: 2 }]);
  });

  it("a folder and an exact path select each file once, and only the exact path is promoted", async () => {
    const { repo, store } = repoWith([A], [B]);
    mkdirSync(join(repo.main, "src"));
    const promoted: TestFileRef[][] = [];
    setTimeout(() => finish(store, repo.mainId, A), 200);

    const read = await wait(repo.main, ["src", A], options(promoted));

    expect(read.selection.files).toEqual([ref(A), ref(B)]);
    expect(read.selection.paths).toEqual([
      { path: "src", kind: "directory", selects: 2 },
      { path: A, kind: "test-file", selects: 1 },
    ]);
    expect(promoted).toEqual([[ref(A)]]);
  });

  it("an empty folder selects none: unmatched, exit 3, at once", async () => {
    const { repo } = current();
    const promoted: TestFileRef[][] = [];

    const read = await wait(repo.main, ["empty"], options(promoted));

    expect([read.outcome, namedCode(read), promoted]).toEqual(["unmatched", 3, []]);
    expect(read.selection.paths).toEqual([{ path: "empty", kind: "directory", selects: 0 }]);
    expect(read.selection.unmatched).toEqual(["empty"]);
    expect(namedText(read, NOW)).toContain("no listed test file is under the folder empty");
  });

  it("a folder while the runner has not listed the revision: at least, complete false", async () => {
    const { repo, store } = current();
    store.revisions.append({
      worktreeId: repo.mainId,
      createdAt: NOW - 10_000,
      head: null,
      dirty: false,
      trigger: "watch",
      changes: [{ path: "src/other.ts", oldHash: "a", newHash: "b" }],
    });
    recordRefinedApplied(store, repo.mainId, 4);

    const read = await wait(repo.main, ["src"], {
      ...options([], 200),
      settleMs: 0,
      sync: sync(5),
    });

    expect(read.selection.partial).toEqual({ revision: 5 });
    expect((await printed(read)).complete).toBe(false);
    expect(namedText(read, NOW)).toContain(
      "Directory: src; it selects at least 2 listed test files under it",
    );
  });
});

describe("a path that is neither a file nor a folder (011-406)", () => {
  it("names the listed test files that start with it, selects none, exit 3", async () => {
    const { repo } = current();

    const read = await snapshot(repo.main, ["src/a"]);

    expect(read.selection.files).toEqual([]);
    expect(read.selection.paths).toEqual([{ path: "src/a", kind: "unmatched", selects: 0 }]);
    expect(namedCode(read)).toBe(3);
    expect(namedText(read, NOW)).toContain(
      `no test file's closure holds src/a; it is not a file or folder; 1 listed test file starts with it: ${A}; name them`,
    );
  });

  it("names two and more as a count", async () => {
    const { repo } = current();

    const read = await snapshot(repo.main, ["src/"]);
    // `src/` is the folder; `src/b` is a prefix of one file, `s` of both.
    const prefix = await snapshot(repo.main, ["s"]);

    expect(read.selection.paths[0]?.kind).toBe("directory");
    expect(namedText(prefix, NOW)).toContain(
      `it is not a file or folder; 2 listed test files start with it: ${A}, ${B}; name them`,
    );
  });

  it("a source path on disk keeps its closure text, without a prefix hint", async () => {
    const { repo } = current();
    writeFileSync(join(repo.main, "src", "a"), "");

    const read = await snapshot(repo.main, ["src/a"]);

    expect(read.selection.paths).toEqual([{ path: "src/a", kind: "unmatched", selects: 0 }]);
    const text = namedText(read, NOW);
    expect(text).toContain("no test file's closure holds src/a");
    expect(text).not.toContain("start with it");
  });
});
