import { describe, expect, it } from "vitest";
import { type AtAskPorts, type AtRow, choose } from "../../src/core/daemon/at-asks.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import type { CommitAskRequest } from "../../src/core/types/commit-ask.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";

/*
 * Row 023-70 (review 0.1.610, "outside this wave"): D4.9 over the files
 * with a result stored at their live key. Before, `choose` set them aside
 * before it applied refusals, so a stored result whose run read what the
 * commit does not hold read as the commit's. A path git does not hold
 * refuses a stored file as it refuses one to run. Row 023-76: a folder read
 * refuses none, since its key holds the names the run listed; a stored
 * result of a file that lists a folder is the commit's whichever tree wrote
 * it. The real daemons' cases are `test/cli/status-at-stored-refused.test.ts`
 * and `test/cli/status-at-arrival-listing.test.ts`.
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

function ports(stored: readonly TestFileRef[]): AtAskPorts {
  const keyOf = (ref: TestFileRef): CheckKey => `key-${ref.path}`;
  return {
    setup: () => ({ phase: "ready" }),
    started: async () => {},
    // The change selects every file: each would run but for its stored result.
    changedSelects: async () => ROWS.map((row) => row.testFile),
    rows: () => ROWS,
    stored: (ref, key) =>
      key === keyOf(ref) && stored.some((r) => testFileId(r) === testFileId(ref)),
    needs: async () => new Map([[testFileId(GEN), "src/gen.ts"]]),
    groupOf: () => "tests",
    request: async () => {},
    changed: () => {},
  };
}

const ALL = ROWS.map((row) => row.testFile);

describe("a stored result passes D4.9 before it counts as the commit's (rows 023-70, 023-76)", () => {
  it("refuses a stored file whose reads the commit does not hold, and keeps a folder reader's", async () => {
    const chosen = await choose(request, ports(ALL));
    expect(chosen?.refused).toEqual([{ ref: GEN, reason: "needs src/gen.ts" }]);
    // None runs at the commit; the working tree's W1 selection keeps both held files.
    expect(chosen?.named).toEqual([]);
    expect(chosen?.rest).toEqual([]);
    expect(chosen?.withResult).toEqual([LISTS, PLAIN]);
  });

  it("queues a folder reader with no result as any other file", async () => {
    const chosen = await choose(request, ports([]));
    expect(chosen?.refused).toEqual([{ ref: GEN, reason: "needs src/gen.ts" }]);
    expect(chosen?.rest).toEqual([LISTS, PLAIN]);
  });
});
