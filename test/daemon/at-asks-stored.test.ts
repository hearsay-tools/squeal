import { describe, expect, it } from "vitest";
import {
  type AtAskPorts,
  type AtRow,
  choose,
  storedReason,
} from "../../src/core/daemon/at-asks.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import type { CommitAskRequest } from "../../src/core/types/commit-ask.js";
import type { RelativePath } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";

/*
 * Row 023-70 (review 0.1.610, "outside this wave"): D4.9 over the files
 * with a result stored at their live key. Before, `choose` set them aside
 * before it applied refusals, so a stored result whose run read what the
 * commit does not hold read as the commit's. A path git does not hold
 * refuses a stored file as it refuses one to run; a folder read refuses it
 * unless the commit worktree wrote a result there (`ownResult`); a clean
 * one stays the commit's, with no run. Review 0.1.611 B1: a chosen file
 * that lists a folder is in `ownOnly`, so the reader applies the same rule
 * to a result that arrives after this selection. The real daemons' cases
 * are `test/cli/status-at-stored-listing.test.ts` and
 * `test/cli/status-at-arrival-listing.test.ts`.
 */

const ref = (path: string): TestFileRef => ({ project: "", path });
const GEN = ref("test/gen.test.ts");
const LISTS = ref("test/lists.test.ts");
const PLAIN = ref("test/plain.test.ts");
const ROWS: AtRow[] = [GEN, LISTS, PLAIN].map((testFile) => ({
  testFile,
  key: `key-${testFile.path}`,
  pending: null,
}));

const request: CommitAskRequest = {
  type: "commit-ask",
  owner: "call-1",
  changed: ["src/plain.ts"],
  named: [],
  allMissing: false,
};

interface Store {
  /** The files with a result stored at their live key. */
  readonly stored: readonly TestFileRef[];
  /** Of those, the ones the commit worktree wrote. */
  readonly own?: readonly TestFileRef[];
}

function ports(seen: TestFileRef[][], store: Store): AtAskPorts {
  const has = (refs: readonly TestFileRef[] | undefined, ref: TestFileRef) =>
    (refs ?? []).some((r) => testFileId(r) === testFileId(ref));
  const keyOf = (ref: TestFileRef): CheckKey => `key-${ref.path}`;
  return {
    setup: () => ({ phase: "ready" }),
    started: async () => {},
    // The change selects every file: each would run but for its stored result.
    changedSelects: async () => ROWS.map((row) => row.testFile),
    rows: () => ROWS,
    stored: (ref, key) => key === keyOf(ref) && has(store.stored, ref),
    ownResult: (ref, key) => key === keyOf(ref) && has(store.own, ref),
    needs: async () => new Map([[testFileId(GEN), "src/gen.ts"]]),
    listings: async (refs) => {
      seen.push([...refs]);
      return new Map<string, RelativePath>([[testFileId(LISTS), "test/fixtures/"]]);
    },
    groupOf: () => "tests",
    request: async () => {},
    changed: () => {},
  };
}

const ALL = ROWS.map((row) => row.testFile);
const LISTED = { ref: LISTS, reason: storedReason("test/fixtures/") };

describe("a stored result passes D4.9 before it counts as the commit's (row 023-70)", () => {
  it("refuses stored files whose reads the commit does not hold, and keeps a clean one", async () => {
    const seen: TestFileRef[][] = [];
    const chosen = await choose(request, ports(seen, { stored: ALL }));
    expect(seen).toEqual([ALL]);
    expect(chosen?.refused).toEqual([{ ref: GEN, reason: "needs src/gen.ts" }, LISTED]);
    // Neither runs at the commit, and the working tree's W1 selection keeps only the clean one.
    expect(chosen?.named).toEqual([]);
    expect(chosen?.rest).toEqual([]);
    expect(chosen?.withResult).toEqual([PLAIN]);
    expect(chosen?.ownOnly).toEqual([]);
  });

  it("keeps a folder read's stored result the commit worktree wrote, for its own records only", async () => {
    const chosen = await choose(request, ports([], { stored: ALL, own: [LISTS] }));
    expect(chosen?.refused).toEqual([{ ref: GEN, reason: "needs src/gen.ts" }]);
    expect(chosen?.withResult).toEqual([LISTS, PLAIN]);
    expect(chosen?.ownOnly).toEqual([LISTED]);
  });

  it("marks a folder read it queues, so a result that arrives later is judged too (review 0.1.611 B1)", async () => {
    const chosen = await choose(request, ports([], { stored: [] }));
    expect(chosen?.refused).toEqual([{ ref: GEN, reason: "needs src/gen.ts" }]);
    expect(chosen?.rest).toEqual([LISTS, PLAIN]);
    expect(chosen?.ownOnly).toEqual([LISTED]);
  });
});
