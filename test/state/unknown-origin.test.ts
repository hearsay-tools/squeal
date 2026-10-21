import { describe, expect, it } from "vitest";
import { planDelta } from "../../src/core/delivery/index.js";
import { createStateSink } from "../../src/core/state/index.js";
import { formatStatus, formatWhy, readStatus, readWhy } from "../../src/core/status/index.js";
import type { KnownState } from "../../src/core/types/index.js";
import { appendRevisions, fakeRepo, seedStore } from "../status/helpers.js";
import { COMMIT, LOGIN, seedLogin } from "../status/why-seed.js";

/*
 * Task 011-59 (gh-66 part (b); spec 011 C5, C7; research issue-66 Q1): a
 * timeout or a crash is this worktree's own event, never stored under a
 * key, so a check it makes unknown reads origin `own` at the commit of
 * its revision, not the inherited result's origin and commit.
 */
const HEAD = "def5678abc1234def5678abc1234def5678abc12";
const AUTH = { project: "", path: "src/auth.test.ts" };
const QUERY = "src/auth.test.ts > auth > login";

/** Worktree `b` inherited `auth > login` from the main worktree at `COMMIT`; revision 3 is at `head`. */
function timedOut(head: string | null, reason: string) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const b = seedLogin(repo, store);
  expect(store.knownStates.get(b.id, LOGIN)?.origin).toMatchObject({ kind: "inherited" });
  appendRevisions(store, b.id, 1, { head, dirty: true });
  createStateSink(store, { now: () => 5_000 }).markUnknown(b.id, 3, [AUTH], reason);
  const state = store.knownStates.get(b.id, LOGIN) as KnownState;
  const why = formatWhy(readWhy(b.root, QUERY));
  return { repo, b, state, why };
}

describe("a check a timeout or crash makes unknown (task 011-59)", () => {
  it.each(["timed out after 2 s", "runner crashed: worker exited"])(
    "reads origin own at its revision's commit after an inherited pass: %s",
    (reason) => {
      const { repo, b, state, why } = timedOut(HEAD, reason);
      expect(state).toMatchObject({
        outcome: "unknown",
        observedAt: 3,
        commit: HEAD,
        origin: { kind: "own" },
        summary: reason,
      });
      expect(why).toMatch(/^Known state: UNKNOWN, \w+, observed at revision 3, commit def5678$/m);
      expect(why).not.toContain("Origin:");

      // The notice's entry and status name no other worktree.
      const plan = planDelta({
        view: [{ check: LOGIN, outcome: "pass", fingerprint: null, toldAt: 1 }],
        states: [state],
        isBaselineFinding: () => false,
        toldAt: 2,
        rootOf: (id) => (id === repo.mainId ? repo.main : null),
        revision: 3,
      });
      expect(plan.entries).toHaveLength(1);
      expect(plan.entries[0]).toMatchObject({ to: "unknown", origin: { kind: "own" } });
      expect(plan.entries[0]).not.toHaveProperty("originRoot");
      const status = formatStatus(readStatus(b.root), 6_000, "squeal", { full: true });
      expect(status).not.toContain(repo.main);
    },
  );

  it("keeps the previous commit, with origin own, when its revision names no commit", () => {
    const { state, why } = timedOut(null, "timed out after 2 s");
    expect(state).toMatchObject({ outcome: "unknown", commit: COMMIT, origin: { kind: "own" } });
    expect(why).toMatch(/^Known state: UNKNOWN, \w+, observed at revision 3, commit abc1234$/m);
    expect(why).not.toContain("Origin:");
  });
});
