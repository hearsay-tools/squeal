import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { Keeper } from "../../src/core/code/gate/keep.js";
import type { Hasher } from "../../src/core/hash/hasher.js";
import { StatCache } from "../../src/core/hash/stat-cache.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { mergeHoldOf, unheldNow } from "../../src/core/run-evidence/run-evidence.js";
import type { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { git, writeTree } from "../keys/validity/harness/shared.js";

/*
 * Row 011-320 (difference 3; spec 011 C9): `squeal code` reads the merge
 * hold as the daemon's `MergeHold` does, the unmerged index paths, at its
 * decision (the table's row "difference 3") and again at each write, as
 * the daemon's record reads its hold at each try (`TierRecords.#heldNow`).
 */

const A: TestFileRef = { project: "", path: "test/a.test.ts" };
const KEY_A = "a".repeat(64) as CheckKey;
const INPUT = "src/a.mjs";
const RECORD = { v: 1, sources: [], unread: [] } as never;
const STAT = { mtimeMs: 1, ctimeMs: 1, size: 1, inode: 1 };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repository whose one commit holds `src/a.mjs` and `src/b.mjs`. */
function repository(): string {
  const scratch = mkdtempSync(join(tmpdir(), "squeal-hold-"));
  dirs.push(scratch);
  const root = writeTree(join(scratch, "repo"), {
    [INPUT]: "export const a = 1;\n",
    "src/b.mjs": "export const b = 2;\n",
  });
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "fixture"]);
  return root;
}

/** Marks `path` unmerged, its three stages at the bytes it holds, as a conflicted merge leaves it. */
function unmerge(root: string, path: string): void {
  const blob = git(root, ["rev-parse", `:${path}`]).trim();
  const stages = [1, 2, 3].map((stage) => `100644 ${blob} ${stage}\t${path}`);
  const input = [`0 ${"0".repeat(blob.length)}\t${path}`, ...stages].join("\n");
  execFileSync("git", ["update-index", "--index-info"], { cwd: root, input: `${input}\n` });
}

describe("squeal code's merge hold (row 011-320, 011 C9)", () => {
  it("names the unmerged index paths, and reads them again once the index moved", async () => {
    const root = repository();
    const hold = mergeHoldOf(root);
    const files = [{ paths: [INPUT] }, { paths: ["src/b.mjs"] }];

    expect(await unheldNow(hold, files)).toEqual(files);
    unmerge(root, INPUT);
    expect(await unheldNow(hold, files)).toEqual([files[1]]);
    git(root, ["add", INPUT]);
    expect(await unheldNow(hold, files)).toEqual(files);
  });

  it("holds nothing where git reads no index, as the daemon's hold before its first read", async () => {
    const files = [{ paths: [INPUT] }];

    expect(await unheldNow(mergeHoldOf("/nowhere"), files)).toEqual(files);
  });

  it.each([
    ["writes the file when no merge holds it", false, 1],
    ["does not write a file a merge holds by its write", true, 0],
  ])("%s", async (_, merging, results) => {
    const root = repository();
    const notes: string[] = [];
    const keep = new Keeper({
      root,
      commonDir: join(root, ".git"),
      policy: { ...DEFAULT_POLICY, complexity: { ...DEFAULT_POLICY.complexity, enabled: true } },
      head: async () => ({ head: "a".repeat(40), dirty: false }),
      note: (text) => notes.push(text),
    });
    keep.expect("vitest", keysOf(INPUT), HASHER, new Map([[A, KEY_A]]));
    await keep.ran({
      runner: "vitest",
      files: [A],
      report: {
        end: "completed",
        durationMs: 1,
        completedFiles: [A],
        results: [],
        fileErrors: [],
        failure: null,
      },
      records: new Map([[testFileId(A), { record: RECORD }]]),
    });
    // After the run's decision, before the write: a merge leaves the file's input unmerged.
    if (merging) unmerge(root, INPUT);
    await keep.flush();

    expect([resultsAt(join(root, ".git")), notes]).toEqual([results, []]);
  });
});

/** Inputs that never move: every stat and hash is the one the lookup copied. */
const HASHER: Hasher = { stat: async () => STAT, hash: async () => "h", now: () => 1_000_000 };

/** A lookup's keys, `test/a.test.ts` reading `input` alone. */
function keysOf(input: string): WorktreeKeys {
  return {
    cache: new StatCache([{ path: input, ...STAT, hash: "h" }]),
    stabilityPaths: () => [input],
    beginRun: () => 1,
    endRun: () => {},
    observes: () => false,
    environmentFiles: () => [],
  } as unknown as WorktreeKeys;
}

/** The results stored at `KEY_A`; none while there is no store. */
function resultsAt(commonDir: string): number {
  const path = storePaths(commonDir).database;
  if (!existsSync(path)) return 0;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare("SELECT count(*) AS n FROM results WHERE key = ?").get(KEY_A);
    return Number(row?.n);
  } finally {
    db.close();
  }
}
