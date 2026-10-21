import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import { publishPromotions } from "../../src/core/scheduler/promotions.js";
import { yieldsMetaKey } from "../../src/core/scheduler/yields.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { groupId } from "../../src/core/status/standing-groups.js";
import { type RevisionNumber, refinedMetaKey } from "../../src/core/types/index.js";
import { A, B, C, key, NOW, ref, repoWith } from "../cli/status-wait-fixture.js";

/*
 * Row 011-57 (011-51 notes): a group's line states each file's own yield. A
 * promoted file whose run yields and an unpromoted one, both queued behind
 * the revision's runner part, read apart.
 */

/** The lines of the `Outstanding:` block, its heading left out. */
function outstanding(root: string): string[] {
  const status = readStatus(root, { now: () => NOW });
  if (!status.available) throw new Error(status.message);
  const lines = formatStatus(status, NOW, "squeal").split("\n");
  const at = lines.indexOf("Outstanding:");
  const end = lines.findIndex((l, i) => i > at && !l.startsWith("  "));
  return lines.slice(at + 1, end);
}

describe("a status group shows each file's yield (011-57)", () => {
  it("an unlisted revision: the promoted file whose run yields reads apart from the other", () => {
    const { repo, store } = repoWith([A, B]);
    const id = repo.mainId;
    store.meta.set(refinedMetaKey(id), "3");
    key(store, id, C, "running");
    store.runs.start({
      id: "run-c",
      worktreeId: id,
      revision: 3 as RevisionNumber,
      testFiles: [ref(C)],
      checkpointId: null,
      logDir: "/tmp/run-c",
      startedAt: NOW - 30_000,
    });
    publishPromotions(store, id, [{ files: [testFileId(ref(A))], until: NOW + 60_000 }], NOW);
    store.meta.set(
      yieldsMetaKey(id),
      JSON.stringify({ at: NOW - 1_000, tiers: { "run-c": { kind: "yields" } } }),
    );

    const lines = outstanding(repo.main).filter((l) => l.includes("not listed yet"));

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^ {2}1 test file queued, revision 4 not listed yet, .*; the run yields: src\/a\.test\.ts/,
    );
    expect(lines[1]).toMatch(
      /^ {2}1 test file queued, revision 4 not listed yet, [^;]*: src\/b\.test\.ts/,
    );
  });

  it("groupId tells standings apart by their yield", () => {
    const unlisted = { kind: "unlisted", revision: 4, callBoundMs: 66_000 } as const;
    const queued = { kind: "queued", lane: "vitest", behind: NOW, promoted: true } as const;

    expect(groupId({ ...unlisted, yields: { kind: "yields" } })).not.toBe(groupId(unlisted));
    expect(groupId({ ...queued, yields: { kind: "yields" } })).not.toBe(
      groupId({ ...queued, yields: { kind: "turn" } }),
    );
    expect(groupId({ ...queued, yields: { kind: "remainder", remainderMs: 10_000 } })).not.toBe(
      groupId({ ...queued, yields: { kind: "remainder", remainderMs: 20_000 } }),
    );
  });
});
