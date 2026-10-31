import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import { writeRetries } from "../../src/core/retry/records.js";
import { publishPromotions } from "../../src/core/scheduler/promotions.js";
import type { CheckKey, EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { config, named } from "./next-step-seed.js";
import { B, NOW, ref, repoWith, SLOW_FILE } from "./status-wait-fixture.js";

/*
 * Row 011-283 (011-273 option B, `research/named-wait-rule.md` rule 5):
 * named-wait order leaves a retry's run and a named slow file where they
 * were, and the named wait's line says what each waits for, in the text
 * and in `--json`'s `reason` alike.
 */

const RETRY = "retry: normal priority; waits for named groups and edits' work";
const QUEUED = "queued; no run is open and nothing recorded holds it";
const NEXT =
  "the store records no reason the daemon has not taken it (`squeal status --json` lists each file's state)";

/** A pending `squeal retry` of `path` at its queued key, which `worktreeId`'s daemon queued. */
function retried(store: Parameters<typeof writeRetries>[0], worktreeId: string, path: string) {
  writeRetries(store, [
    {
      id: "r1",
      testFile: ref(path),
      key: `key-${path}-queued` as CheckKey,
      session: "s1",
      reason: "load",
      askedAt: NOW,
      askedIn: worktreeId as WorktreeId,
      claim: { worktreeId: worktreeId as WorktreeId, at: NOW },
      end: null,
    },
  ]);
}

describe("why a retry's run and a named slow file wait (row 011-283)", () => {
  it("a retry's queued run: normal priority, in the text and the JSON", () => {
    const { repo, store } = repoWith([B]);
    retried(store, repo.mainId, B);

    const { lines, groups, entries } = named(store, repo.mainId, repo.main, [B]);

    expect(lines[1]).toBe(`  1 ${QUEUED}; ${RETRY}: ${B}; ${NEXT}`);
    expect(groups).toBe("1 queued, nothing recorded holds it; retry: normal priority");
    expect(entries[0]?.reason).toBe(`${QUEUED}; ${RETRY}`);
  });

  it("a retry's run a wait promoted reads promoted, with no retry words", () => {
    const { repo, store } = repoWith([B]);
    retried(store, repo.mainId, B);
    const files = [testFileId(ref(B))];
    publishPromotions(
      store,
      repo.mainId as WorktreeId,
      [{ files, until: (NOW + 60_000) as EpochMs }],
      NOW,
    );

    const { entries } = named(store, repo.mainId, repo.main, [B]);

    expect(entries[0]?.reason).toMatch(/^queued, promoted/);
    expect(entries[0]?.reason).not.toContain("retry");
  });

  it("a retry another worktree's daemon queued, or one that ended, adds nothing", () => {
    const { repo, store } = repoWith([B]);
    retried(store, "elsewhere", B);

    expect(named(store, repo.mainId, repo.main, [B]).entries[0]?.reason).toBe(QUEUED);
  });

  it("a named slow file: behind the fast backlog, in the text and the JSON", () => {
    const { repo, store } = repoWith([SLOW_FILE]);
    config(repo.main, { slow: { include: [SLOW_FILE] } });

    const { lines, groups, entries } = named(store, repo.mainId, repo.main, [SLOW_FILE]);

    const reason =
      "slow, behind the fast backlog, run after the fast tests or on `squeal run --slow`";
    expect(lines).toEqual(["Pending (1):", `  1 ${reason}: ${SLOW_FILE}`]);
    expect(groups).toBe("1 slow, behind the fast backlog: `squeal run --slow`");
    expect(entries[0]?.reason).toBe(reason);
  });

  it('under slow.trigger "idle" the slow file keeps its words (004-80)', () => {
    const { repo, store } = repoWith([SLOW_FILE]);
    config(repo.main, { slow: { include: [SLOW_FILE], trigger: "idle" } });

    const { entries } = named(store, repo.mainId, repo.main, [SLOW_FILE]);

    expect(entries[0]?.reason).toBe("slow, run when the agent pauses or on `squeal run --slow`");
  });
});
