import { describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { formatDelta } from "../../src/core/delivery/format.js";
import type { Delta } from "../../src/core/types/delivery.js";
import { settled } from "./status-snapshot.js";

/*
 * Row 005-93 (c): a news header counts the test files the session's own edits affect in place of
 * the worktree's queue. The evals parser reads the files not run as pending, from the real
 * formatter, and still reads the news header before it as it did. Row 005-97: the late and
 * caught-up deliveries carry the same header.
 */

const consumer = { worktreeId: "w1", sessionId: "s1", agentId: "main" };
const header = { ...settled, revision: 7, changedPaths: ["src/a.ts"] };
const text = (parts: Partial<Delta>): string =>
  formatDelta({ schemaVersion: 1, consumer, header, label: "transitions", entries: [], ...parts });
const hook = (t: string) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolBatch", additionalContext: t } });
const read = (t: string) => squealEvidence(hook(t), "push", 0);

describe("the own count, as the evals parser reads it (row 005-93 c)", () => {
  it("reads the files not run as pending", () => {
    const t = text({ ownEdits: { files: 9, owed: 3 } });
    expect(t).toContain(
      "Revision 7 (changed src/a.ts): 3 of the 9 test files your edits affect have not run.",
    );
    expect(read(t)).toMatchObject({ revision: 7, pending: 3, stale: 0, unknown: 0, news: true });
    expect(read(t)?.verdict).not.toBe("pass");
    const one = text({ ownEdits: { files: 1, owed: 1 } });
    expect(read(one)).toMatchObject({ pending: 1, news: true });
  });

  it("reads all run as nothing pending", () => {
    for (const files of [1, 9]) {
      const t = text({ ownEdits: { files, owed: 0 } });
      expect(read(t)).toMatchObject({ revision: 7, pending: 0, stale: 0, unknown: 0, news: true });
      expect(read(t)?.verdict).toBe("pass");
    }
  });

  it("reads no counts from a header with no own count, so no pass", () => {
    const t = text({
      commitChanged: true,
      header: {
        ...header,
        commitLine: { commit: "abc1234", text: "Commit abc1234: 0 known failures" },
      },
    } as never);
    expect(t).toContain("Revision 7 (changed src/a.ts).");
    expect(read(t)).toMatchObject({ revision: 7, pending: null });
    expect(read(t)?.verdict).not.toBe("pass");
  });

  it("reads the late and caught-up deliveries by their header (row 005-97)", () => {
    const late = text({
      ownEdits: { files: 9, owed: 7 },
      editsLate: { kind: "owed", revision: 7, owed: 7, files: 9, editRevision: 6, ageMs: 130_000 },
    });
    expect(late.split("\n")[0]).toBe("SQUEAL · results for your edits are late at revision 7");
    expect(read(late)).toMatchObject({ revision: 7, pending: 7 });
    const caught = text({
      ownEdits: { files: 9, owed: 0 },
      caughtUp: { revision: 7, files: 9, unknown: 0 },
    });
    expect(caught.split("\n")[0]).toBe("SQUEAL · caught up at revision 7");
    expect(read(caught)).toMatchObject({ revision: 7, pending: 0, verdict: "pass" });
  });

  // Review 0.1.530 B4: a file that ran with no result is never a pass.
  it("reads an unknown result in caught up and in the own count, never as a pass", () => {
    const caught = text({
      ownEdits: { files: 1, owed: 0 },
      caughtUp: { revision: 7, files: 1, unknown: 1 },
    });
    expect(caught).toContain("0 with results, 1 with no result (unknown); no new failure.");
    expect(read(caught)).toMatchObject({ pending: 0, unknown: 1 });
    expect(read(caught)?.verdict).not.toBe("pass");
    const news = text({ ownEdits: { files: 3, owed: 0, unknown: 1 } });
    expect(news).toContain(
      "Revision 7 (changed src/a.ts): the 3 test files your edits affect have all run; 1 with no result (unknown).",
    );
    expect(read(news)).toMatchObject({ pending: 0, unknown: 1 });
    expect(read(news)?.verdict).not.toBe("pass");
    const owing = text({ ownEdits: { files: 3, owed: 1, unknown: 1 } });
    expect(owing).toContain(
      "1 of the 3 test files your edits affect has not run; 1 with no result (unknown).",
    );
    expect(read(owing)).toMatchObject({ pending: 1, unknown: 1 });
  });

  it("still reads 0.1.527's news headers as before", () => {
    const old = [
      [
        "Revision 7 (changed src/a.ts): 3 pending (2 tests, 1 test file loaded), 1 stale (1 test).",
        3,
        1,
        0,
      ],
      ["Revision 7 (changed src/a.ts): no check pending, stale or unknown.", 0, 0, 0],
      ["Revision 7: test files without checks: 2 pending, 97 unknown.", 2, 0, 97],
    ] as const;
    for (const [line, pending, stale, unknown] of old)
      expect(read(`SQUEAL · revision 7\n${line}`)).toMatchObject({
        pending,
        stale,
        unknown,
        news: true,
      });
  });
});
