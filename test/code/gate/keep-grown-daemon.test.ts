import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { readPolicy } from "../../../src/core/daemon/policy.js";
import { git, writeTree } from "../../keys/validity/harness/shared.js";
import { keepsOf } from "./keep-daemon-kit.js";
import {
  A,
  B,
  GROWN_NOT_KEPT,
  type KeepOptions,
  keep,
  keyOf,
  READ,
  resultsAt,
  rowsOf,
  servedWorktree,
  type Worktree,
} from "./keep-grown-kit.js";

/*
 * Row 020-48 (spec 020 D17.3, #206): where a daemon serves the worktree,
 * the keeper sends it the runs' reads first, and it merges them into the
 * shared rows and writes a file at the key with what its run read, as the
 * keeper does where none serves (row 020-39). A daemon before this row
 * refuses the reads: the grown file is told as not kept, as before, and the
 * others are written. What bars a keep is the keeper's, before any write,
 * whichever writes: a read first seen during the run, a moved runtime
 * identity, a merge that holds a path the key names.
 */

describe("the keeper while a daemon serves, a file whose run read beyond its key (row 020-48)", () => {
  it("is kept at that key, and the daemon merges the read and its marks first", async () => {
    const at = await servedWorktree();
    const notes: string[] = [];

    const ran = await keep(at, notes, { files: [A, B] });

    const grown = keyOf(at.keys, A);
    expect(grown).not.toBe(ran);
    expect(keepsOf(at.served)).toEqual([
      ["seen", null],
      ["coverage", grown],
      ["results", grown],
      ["coverage", keyOf(at.keys, B)],
      ["results", keyOf(at.keys, B)],
    ]);
    expect(at.served.keeps[0]?.write).toEqual({
      kind: "seen",
      seen: [{ ref: A, add: [READ], direct: [READ], modules: ["src/a.ts"] }],
    });
    expect([resultsAt(at.commonDir, grown), resultsAt(at.commonDir, ran)]).toEqual([1, 0]);
    expect(rowsOf(at.commonDir)).toEqual([[READ], [READ], ["src/a.ts"]]);
    expect(notes).toEqual([]);
  });

  it("is told as not kept, as before, by a daemon before this row, which writes the others", async () => {
    const at = await servedWorktree({ takesSeen: false });
    const notes: string[] = [];

    await keep(at, notes, { files: [A, B] });

    expect(keepsOf(at.served)).toEqual([
      ["coverage", keyOf(at.keys, B)],
      ["results", keyOf(at.keys, B)],
    ]);
    expect(resultsAt(at.commonDir, keyOf(at.keys, B))).toBe(1);
    expect(notes).toEqual([GROWN_NOT_KEPT]);
    expect(rowsOf(at.commonDir)).toEqual([undefined, undefined, undefined]);
  });

  it("is not kept, with the notes before this row, where the daemon takes no kept files", async () => {
    const at = await servedWorktree({ takesKeeps: false });
    const notes: string[] = [];

    await keep(at, notes, { files: [A, B] });

    expect(notes).toEqual([
      "1 completed test file was not kept in the stores: a daemon runs in this worktree, and it keeps its own",
      GROWN_NOT_KEPT,
    ]);
    expect(rowsOf(at.commonDir)).toEqual([undefined, undefined, undefined]);
    expect(resultsAt(at.commonDir, keyOf(at.keys, B))).toBe(0);
  });
});

/** Marks `path` unmerged, its three stages at the bytes it holds, as a conflicted merge leaves it. */
function unmerge(root: string, path: string): void {
  const blob = git(root, ["rev-parse", `:${path}`]).trim();
  const stages = [1, 2, 3].map((stage) => `100644 ${blob} ${stage}\t${path}`);
  const input = [`0 ${"0".repeat(blob.length)}\t${path}`, ...stages].join("\n");
  execFileSync("git", ["update-index", "--index-info"], { cwd: root, input: `${input}\n` });
}

const LATE = "data/late.txt";

/** What bars the keep of `a` while a daemon serves: the options of its run, and its note. */
const BARS: readonly (readonly [string, (at: Worktree) => KeepOptions, string])[] = [
  [
    "a read first seen during the run",
    (at) => ({
      observed: { testFile: A, paths: [LATE], directories: [], direct: [], modules: [] },
      started: () => writeTree(at.root, { [LATE]: "late\n" }),
    }),
    `1 completed test file was not kept in the stores, because it read paths first seen during the run (${LATE}): test/a.test.ts; the next run will run it again`,
  ],
  [
    "a merge that holds a path its key names",
    (at) => ({ started: () => unmerge(at.root, "src/a.ts") }),
    "1 completed test file was not kept in the stores, because a merge holds a path its key names: test/a.test.ts; the next run will run it again",
  ],
];

describe("what bars a keep while a daemon serves (row 020-48)", () => {
  it.each(BARS)("%s keeps the file from the daemon's writes", async (_, options, note) => {
    const at = await servedWorktree();
    const notes: string[] = [];

    await keep(at, notes, { files: [A, B], ...options(at) });

    const writes = keepsOf(at.served).filter(([kind]) => kind !== "seen");
    expect(writes).toEqual([
      ["coverage", keyOf(at.keys, B)],
      ["results", keyOf(at.keys, B)],
    ]);
    expect(notes).toEqual([note]);
  });

  it("merges a first-seen read through the daemon, so the next run keys the file with it", async () => {
    const at = await servedWorktree();
    const [, options] = BARS[0] as (typeof BARS)[number];

    await keep(at, [], { files: [A, B], ...options(at) });

    expect(rowsOf(at.commonDir)[0]).toEqual([LATE]);
  });

  it("a moved runtime identity keeps both files from the daemon's writes", async () => {
    const at = await servedWorktree();
    const notes: string[] = [];
    let identity = "node 26";
    const rules = readPolicy(at.root);
    const runtime = { identity: () => identity, rules, rulesNow: () => readPolicy(at.root) };

    await keep(at, notes, {
      files: [A, B],
      sources: { runtime },
      started: () => {
        identity = "node 24";
      },
    });

    expect(keepsOf(at.served).filter(([kind]) => kind !== "seen")).toEqual([]);
    expect(notes).toEqual([
      "2 completed test files were not kept in the stores, because the runtime's identity moved during the run: test/a.test.ts, test/b.test.ts; the next run will run them again",
    ]);
  });
});
