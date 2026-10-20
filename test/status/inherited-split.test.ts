import { describe, expect, it } from "vitest";
import { formatDelta, headerLines } from "../../src/core/delivery/index.js";
import { readHeader } from "../../src/core/state/index.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import type { Delta } from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, fileCheck, seedStore, state } from "./helpers.js";

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const COMMIT = "abcdef1234567890abcdef1234567890abcdef12";

/**
 * Review wave 3 B1's probe: one current test and its file-level check, both
 * inherited from the same other worktree. Every count of them names the
 * test and the file-level check apart (spec 005 D1).
 */
describe("inherited counts and delivery titles (spec 005 D1, review wave 3 B1)", () => {
  it("name tests and file-level checks apart in status and the header", () => {
    const repo = fakeRepo();
    const b = repo.addWorktree("b");
    const store = seedStore(repo);
    store.worktrees.upsert({
      id: "other",
      root: "other",
      commonDir: repo.commonDir,
      isMain: false,
      registeredAt: 1,
      daemon: null,
    });
    appendRevisions(store, b.id, 1, { head: COMMIT, dirty: false });
    const origin = { kind: "inherited", worktreeId: "other", commit: COMMIT } as const;
    store.knownStates.upsertMany([
      state(b.id, check("src/a.test.ts", "adds"), { origin }),
      state(b.id, fileCheck("src/a.test.ts"), { origin }),
    ]);
    const header = readHeader(store, b.id);
    store.close();

    expect(header).toMatchObject({ inheritedCount: 2, inheritedFileLevelCount: 1 });
    expect(headerLines(header, "squeal")[0]).toContain(
      "Revision 1 · abcdef12 + 1: 2 current (1 test, 1 test file loaded), 0 pending, 0 stale, 0 unknown. " +
        "Inherited: 2 of 2 current (1 test, 1 test file loaded).",
    );
    const status = formatStatus(readStatus(b.root, { now: () => NOW }), NOW, "squeal", {
      full: true,
    }).split("\n");
    expect(status).toContain(
      "Inherited from other worktrees: 2 current results (1 test, 1 test file loaded)",
    );
    expect(status).toContain("  2 (1 test, 1 test file loaded) from other at abcdef1");

    const delta: Delta = {
      schemaVersion: 1,
      consumer: { worktreeId: b.id, sessionId: "s", agentId: "main" },
      header,
      label: "transitions",
      entries: [check("src/a.test.ts", "adds"), fileCheck("src/a.test.ts")].map((c) => ({
        kind: "fail-to-pass",
        check: c,
        from: "fail",
        to: "pass",
        validity: "current",
        observedAt: 1,
        origin,
        summary: null,
        location: null,
      })),
    };
    expect(formatDelta(delta).split("\n")[0]).toBe(
      "SQUEAL · 2 checks changed (1 test, 1 test file loaded) at revision 1",
    );
  });
});
