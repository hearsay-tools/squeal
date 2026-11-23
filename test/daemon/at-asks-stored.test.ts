import { describe, expect, it } from "vitest";
import {
  type AtAskPorts,
  type AtRow,
  choose,
  type StoredAt,
  storedReason,
} from "../../src/core/daemon/at-asks.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import type { CommitAskRequest } from "../../src/core/types/commit-ask.js";
import type { RelativePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";

/*
 * Row 023-70 (review 0.1.610, "outside this wave"): D4.9 over the files
 * with a result stored at their live key. Before, `choose` set them aside
 * before it applied refusals, so a stored result whose run read what the
 * commit does not hold read as the commit's. A path git does not hold
 * refuses a stored file as it refuses one to run; a folder read refuses it
 * when another tree ran it (`storedNeeds`); a clean one stays the
 * commit's, with no run. The real daemon's case is
 * `test/cli/status-at-stored-refused.test.ts`.
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

function ports(seen: StoredAt[][]): AtAskPorts {
  return {
    setup: () => ({ phase: "ready" }),
    started: async () => {},
    // The change selects every file: each would run but for its stored result.
    changedSelects: async () => ROWS.map((row) => row.testFile),
    rows: () => ROWS,
    stored: () => true,
    needs: async () => new Map([[testFileId(GEN), "src/gen.ts"]]),
    storedNeeds: async (stored) => {
      seen.push([...stored]);
      return new Map<string, RelativePath>([[testFileId(LISTS), "test/fixtures/"]]);
    },
    groupOf: () => "tests",
    request: async () => {},
    changed: () => {},
  };
}

describe("a stored result passes D4.9 before it counts as the commit's (row 023-70)", () => {
  it("refuses stored files whose reads the commit does not hold, and keeps a clean one", async () => {
    const seen: StoredAt[][] = [];
    const chosen = await choose(request, ports(seen));
    expect(seen).toEqual([ROWS.map((row) => ({ ref: row.testFile, key: row.key }))]);
    expect(chosen?.refused).toEqual([
      { ref: GEN, reason: "needs src/gen.ts" },
      { ref: LISTS, reason: storedReason("test/fixtures/") },
    ]);
    // Neither runs at the commit, and the working tree's W1 selection keeps only the clean one.
    expect(chosen?.named).toEqual([]);
    expect(chosen?.rest).toEqual([]);
    expect(chosen?.withResult).toEqual([PLAIN]);
  });
});
