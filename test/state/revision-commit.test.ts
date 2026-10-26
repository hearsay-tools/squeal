import { realpathSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { headerLines } from "../../src/core/delivery/index.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { recordHeadMove } from "../../src/core/scheduler/head-move.js";
import type { Ledger } from "../../src/core/scheduler/ledger.js";
import { readHeader } from "../../src/core/state/index.js";
import { readGitHead } from "../../src/core/status/git-head.js";
import {
  type CommitSha,
  type HeadMove,
  headMoveMetaKey,
  type Store,
} from "../../src/core/types/index.js";
import { git, initRepo, tempDir, writeFile } from "../hash/git-repo.js";
import { reftableUnsupported } from "../hash/reftable.js";
import { freshStore, WT } from "./helpers.js";

/**
 * Row 011-239: while `unreadable.head` holds, the git dir reader finds no git
 * dir and gives `null`, as it does in a reftable repository.
 */
const unreadable = vi.hoisted(() => ({ head: false }));
vi.mock("../../src/core/fs/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/fs/index.js")>();
  return {
    ...actual,
    gitDirOf: (root: string) => (unreadable.head ? null : actual.gitDirOf(root)),
  };
});
const noReftable = reftableUnsupported();

/*
 * Task 001-406: revisions count per worktree, so a header, status and `why`
 * show the revision beside HEAD's short SHA, the revisions since HEAD last
 * moved, and a dirty marker. The counter itself is unchanged.
 */

const A = "1bc146f0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "2cd257e1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "3de368f2cccccccccccccccccccccccccccccccc";

let store: Store;

beforeEach(() => {
  store = freshStore();
});

function edit(head: CommitSha, dirty = true): void {
  store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head,
    dirty,
    trigger: "watch",
    changes: [{ path: "src/a.ts", oldHash: "h0", newHash: `h${Math.random()}` }],
  });
}

function moved(move: HeadMove): void {
  store.meta.set(headMoveMetaKey(WT), JSON.stringify(move));
}

function line(): string {
  return headerLines(readHeader(store, WT), "squeal")[0] ?? "";
}

describe("a revision shown with its commit (task 001-406)", () => {
  it("clean at HEAD: the revision, HEAD and + 0, no dirty marker", () => {
    edit(A, true);
    edit(A, true);
    moved({ head: B, dirty: false, revision: 2 });
    expect(readHeader(store, WT).commit).toEqual({ head: B, sinceHead: 0, dirty: false });
    expect(line()).toMatch(/^Revision 2 · 2cd257e1 \+ 0: /);
  });

  it("edits after a commit count from the commit, and the revision number goes on", () => {
    edit(A);
    edit(A);
    moved({ head: B, dirty: false, revision: 2 });
    edit(B);
    edit(B);
    edit(B);
    expect(readHeader(store, WT).commit).toEqual({ head: B, sinceHead: 3, dirty: true });
    expect(line()).toMatch(/^Revision 5 · 2cd257e1 \+ 3, dirty: /);
  });

  it("a partial commit leaves + 0, dirty", () => {
    edit(A);
    moved({ head: B, dirty: true, revision: 1 });
    expect(line()).toMatch(/^Revision 1 · 2cd257e1 \+ 0, dirty: /);
  });

  it("a checkout that moves HEAD with its files counts from the checkout's revision", () => {
    edit(A);
    edit(A);
    edit(C, false);
    expect(line()).toMatch(/^Revision 3 · 3de368f2 \+ 0: /);
    edit(C);
    expect(line()).toMatch(/^Revision 4 · 3de368f2 \+ 1, dirty: /);
  });

  it("every revision at one HEAD counts all of them; a move older than the latest revision is past", () => {
    edit(A);
    edit(A);
    expect(readHeader(store, WT).commit?.sinceHead).toBe(2);
    moved({ head: B, dirty: false, revision: 1 });
    expect(readHeader(store, WT).commit).toEqual({ head: A, sinceHead: 2, dirty: true });
  });

  it("before a first commit the revision stands alone", () => {
    edit(null);
    expect(line()).toMatch(/^Revision 1: /);
    expect(readHeader(store, WT).commit).toBeUndefined();
  });
});

describe("a quiet reconciliation pass records HEAD's move (task 001-406)", () => {
  let dir: ReturnType<typeof tempDir>;
  let root: string;
  let heads: number;

  beforeEach(() => {
    dir = tempDir();
    root = realpathSync(dir.path);
    initRepo(root, { "a.txt": "a\n", "b.txt": "b\n" });
    heads = 0;
    unreadable.head = false;
  });

  afterEach(() => dir.cleanup());

  function sha(): string {
    return git(root, ["rev-parse", "HEAD"]).trim();
  }

  function context(dirty: boolean): SchedulerContext {
    return {
      store,
      worktreeId: WT,
      root,
      head: async () => {
        heads++;
        return { head: sha(), dirty };
      },
    } as unknown as SchedulerContext;
  }

  function ledger(head: CommitSha): Ledger {
    return { revision: { number: 4, head, dirty: true } } as unknown as Ledger;
  }

  function recorded(): HeadMove | null {
    const raw = store.meta.get(headMoveMetaKey(WT));
    return raw === null ? null : (JSON.parse(raw) as HeadMove);
  }

  it.each([
    ["the git dir files", false],
    ["git, when the git dir reader gives null", true],
  ])(
    "runs git status only when HEAD moved, and records the move once, HEAD read from %s",
    async (_, nullHead) => {
      // Row 011-239: a pass that compared the reader's `null` with the known `HEAD` wrote the row
      // on every idle pass, about every 30 s, against task 001-412.
      unreadable.head = nullHead;
      expect(readGitHead(root) === null).toBe(nullHead);
      const before = sha();
      await recordHeadMove(context(false), ledger(before));
      expect(heads).toBe(0);
      expect(recorded()).toBeNull();

      writeFile(root, "a.txt", "a2\n");
      writeFile(root, "b.txt", "b2\n");
      git(root, ["commit", "-q", "-m", "partial", "a.txt"]);
      await recordHeadMove(context(true), ledger(before));
      expect(recorded()).toEqual({ head: sha(), dirty: true, revision: 4 });
      expect(heads).toBe(1);

      await recordHeadMove(context(true), ledger(before));
      expect(heads).toBe(1);
    },
  );

  it("records no move while HEAD stays in a reftable repository, and the commit after", async (ctx) => {
    // The git dir reader finds no ref there (`refs/heads` is a file), so git is asked.
    if (noReftable !== null) ctx.skip(noReftable);
    dir.cleanup();
    dir = tempDir();
    root = join(realpathSync(dir.path), "repo");
    git(dir.path, ["init", "-q", "--ref-format=reftable", "-b", "main", "repo"]);
    writeFile(root, "a.txt", "a\n");
    git(root, ["add", "a.txt"]);
    git(root, ["commit", "-q", "-m", "a"]);
    const before = sha();
    await recordHeadMove(context(false), ledger(before));
    expect(heads).toBe(0);
    expect(recorded()).toBeNull();

    writeFile(root, "a.txt", "a2\n");
    git(root, ["commit", "-q", "-am", "a2"]);
    await recordHeadMove(context(false), ledger(before));
    expect(recorded()).toEqual({ head: sha(), dirty: false, revision: 4 });
  });

  it("HEAD moved away and back to the revision's commit keeps the newer dirty flag (review 001-417 B4)", async () => {
    const a = sha();
    writeFile(root, "a.txt", "a2\n");
    git(root, ["commit", "-q", "-am", "b"]);
    const b = sha();
    git(root, ["reset", "-q", "--hard", a]);
    store.revisions.append({
      worktreeId: WT,
      createdAt: 1,
      head: a,
      dirty: false,
      trigger: "watch",
      changes: [{ path: "a.txt", oldHash: "h0", newHash: "h1" }],
    });
    const at = (): Ledger =>
      ({ revision: { number: 1, head: a, dirty: false } }) as unknown as Ledger;
    const real = (): SchedulerContext =>
      ({
        store,
        worktreeId: WT,
        root,
        head: async () => ({
          head: sha(),
          dirty: git(root, ["status", "--porcelain"]).trim() !== "",
        }),
      }) as unknown as SchedulerContext;

    git(root, ["reset", "-q", "--mixed", b]);
    await recordHeadMove(real(), at());
    expect(recorded()).toEqual({ head: b, dirty: true, revision: 1 });
    git(root, ["reset", "-q", "--soft", a]);
    await recordHeadMove(real(), at());

    expect(git(root, ["status", "--porcelain"]).trim()).toBe("MM a.txt");
    expect(recorded()).toEqual({ head: a, dirty: true, revision: 1 });
    expect(readHeader(store, WT).commit).toEqual({ head: a, sinceHead: 0, dirty: true });
    expect(line()).toMatch(new RegExp(`^Revision 1 · ${a.slice(0, 8)} \\+ 0, dirty: `));

    store.revisions.append({
      worktreeId: WT,
      createdAt: 2,
      head: a,
      dirty: false,
      trigger: "watch",
      changes: [{ path: "a.txt", oldHash: "h1", newHash: "h2" }],
    });
    expect(readHeader(store, WT).commit).toEqual({ head: a, sinceHead: 1, dirty: false });
  });
});
