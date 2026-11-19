import { describe, expect, it } from "vitest";
import { toInvalidatedPath } from "../../src/core/scheduler/revision.js";
import type { QueuedRefine } from "../../src/core/scheduler/superseded.js";
import { supersede } from "../../src/core/scheduler/superseded.js";
import type { CheckKey, FileHash } from "../../src/core/types/keys.js";
import type { FileChange } from "../../src/core/types/revision.js";

/*
 * Row 011-396: a newer revision's runner part takes a queued one's. Each
 * path goes from its hash before the older revision to its hash after the
 * newer, so the runner hears of every path either changed.
 */

const h = (text: string) => text as FileHash;
const k = (text: string) => text as CheckKey;
const ref = (path: string) => ({ project: "", path });

function queued(
  number: number,
  changes: FileChange[],
  extra: Partial<QueuedRefine["content"]> = {},
  touched: string[] = [],
): QueuedRefine {
  return {
    revision: {
      worktreeId: "w" as never,
      number,
      createdAt: number as never,
      head: `head${number}` as never,
      dirty: true,
      trigger: "watch",
      changes,
    },
    content: { rekeyed: [], environment: false, ...extra },
    touched,
  };
}

const kinds = (part: QueuedRefine) =>
  Object.fromEntries(part.revision.changes.map((c) => [c.path, toInvalidatedPath(c).kind]));

describe("supersede (row 011-396)", () => {
  it("keeps every path either revision changed, from first to last hash", () => {
    const older = queued(3, [
      { path: "test/kept.test.ts", oldHash: null, newHash: h("k1") },
      { path: "test/gone.test.ts", oldHash: null, newHash: h("g1") },
      { path: "test/back.test.ts", oldHash: h("b0"), newHash: null },
      { path: "src/a.ts", oldHash: h("a0"), newHash: h("a1") },
    ]);
    const newer = queued(4, [
      { path: "test/kept.test.ts", oldHash: h("k1"), newHash: h("k2") },
      { path: "test/gone.test.ts", oldHash: h("g1"), newHash: null },
      { path: "test/back.test.ts", oldHash: null, newHash: h("b1") },
      { path: "src/a.ts", oldHash: h("a1"), newHash: h("a0") },
      { path: "src/b.ts", oldHash: h("b0"), newHash: h("b1"), ignored: true },
    ]);
    const merged = supersede(older, newer);
    expect(merged.revision.number).toBe(4);
    expect(merged.revision.head).toBe("head4");
    expect(kinds(merged)).toEqual({
      "test/kept.test.ts": "add",
      // Added, then deleted: the runner forgets it and the listing runs.
      "test/gone.test.ts": "delete",
      // Deleted, then added again: it exists as it did for the runner.
      "test/back.test.ts": "change",
      // Edited back to its first bytes: still a change, as the runner may have read the middle.
      "src/a.ts": "change",
      "src/b.ts": "change",
    });
    expect(merged.revision.changes.find((c) => c.path === "test/gone.test.ts")?.oldHash).toBe("g1");
    expect(merged.revision.changes.find((c) => c.path === "src/b.ts")?.ignored).toBe(true);
  });

  it("joins the content parts, the key before the older revision winning", () => {
    const older = queued(
      3,
      [{ path: "src/a.ts", oldHash: h("a0"), newHash: h("a1") }],
      {
        rekeyed: [ref("test/a.test.ts")],
        previous: new Map([["\0test/a.test.ts", k("first")]]),
        catchUp: true,
        recent: [ref("test/a.test.ts")],
      },
      ["src/touched.ts", "src/c.ts"],
    );
    const newer = queued(
      4,
      [{ path: "src/c.ts", oldHash: h("c0"), newHash: h("c1") }],
      {
        rekeyed: [ref("test/a.test.ts"), ref("test/c.test.ts")],
        previous: new Map([
          ["\0test/a.test.ts", k("second")],
          ["\0test/c.test.ts", k("c")],
        ]),
        environment: true,
      },
      ["src/touched.ts"],
    );
    const merged = supersede(older, newer);
    expect(merged.content.rekeyed.map((r) => r.path)).toEqual(["test/a.test.ts", "test/c.test.ts"]);
    expect([...(merged.content.previous ?? [])]).toEqual([
      ["\0test/a.test.ts", "first"],
      ["\0test/c.test.ts", "c"],
    ]);
    expect(merged.content.environment).toBe(true);
    // Catch-up only when both were; each counted on its own at apply.
    expect(merged.content.catchUp).toBeUndefined();
    expect(merged.content.recent?.map((r) => r.path)).toEqual(["test/a.test.ts"]);
    expect(merged.content.edits?.map((e) => [[...e.paths], e.catchUp])).toEqual([
      [["src/a.ts"], true],
      [["src/c.ts"], false],
    ]);
    // A touched path a revision changed is a change instead.
    expect(merged.touched).toEqual(["src/touched.ts"]);
  });

  it("keeps each revision's edit through a third", () => {
    const one = queued(3, [{ path: "src/a.ts", oldHash: h("a0"), newHash: h("a1") }], {
      catchUp: true,
    });
    const two = queued(4, [{ path: "src/b.ts", oldHash: h("b0"), newHash: h("b1") }], {
      catchUp: true,
    });
    const three = queued(5, [{ path: "src/a.ts", oldHash: h("a1"), newHash: h("a2") }], {
      catchUp: true,
    });
    const merged = supersede(supersede(one, two), three);
    expect(merged.content.catchUp).toBe(true);
    expect(merged.content.edits?.map((e) => [...e.paths])).toEqual([
      ["src/a.ts"],
      ["src/b.ts"],
      ["src/a.ts"],
    ]);
    expect(merged.revision.changes).toEqual([
      { path: "src/a.ts", oldHash: "a0", newHash: "a2" },
      { path: "src/b.ts", oldHash: "b0", newHash: "b1" },
    ]);
  });
});
