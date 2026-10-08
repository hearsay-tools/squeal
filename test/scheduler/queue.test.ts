import { describe, expect, it } from "vitest";
import { classify, newFileState } from "../../src/core/scheduler/files.js";
import {
  Priority,
  priorityOf,
  RECENT_TIERS_PER_BACKLOG_TIER,
  RunQueue,
} from "../../src/core/scheduler/queue.js";
import type { TestFileRef } from "../../src/core/types/index.js";

const ref = (path: string, project = ""): TestFileRef => ({ project, path });

describe("RunQueue", () => {
  it("bounds starvation: after four recent-only tiers the backlog gets one (review wave 11, N3)", () => {
    expect(RECENT_TIERS_PER_BACKLOG_TIER).toBe(4);
    const queue = new RunQueue();
    for (let i = 0; i < 6; i++) queue.add(ref(`test/backlog${i}.test.ts`), Priority.failing);
    let edit = 0;
    const tiers: string[][] = [];
    for (let t = 0; t < 10; t++) {
      // Edits keep two recent files queued at every tier boundary, a tier holds two.
      while ([...queue.ordered()].filter((r) => queue.isRecent(r)).length < 2) {
        queue.add(ref(`test/recent${edit++}.test.ts`), Priority.direct, false, true);
      }
      const tier = queue.ordered().slice(0, 2);
      const tookBacklog = tier.some((r) => !queue.isRecent(r));
      for (const r of tier) queue.remove(r);
      queue.tierSelected(tookBacklog);
      tiers.push(tier.map((r) => r.path.replace(/^test\/|\.test\.ts$/g, "")));
    }
    expect(tiers.map((tier) => tier.every((name) => name.startsWith("backlog")))).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(tiers[4]).toEqual(["backlog0", "backlog1"]);
  });

  it("orders by priority, then by first queued, then by project and path", () => {
    const queue = new RunQueue();
    queue.add(ref("test/d.test.ts"), Priority.neverRun);
    queue.add(ref("test/c.test.ts"), Priority.transitive);
    queue.add(ref("test/b.test.ts"), Priority.transitive);
    queue.add(ref("test/a.test.ts"), Priority.failing);
    expect(queue.ordered().map((r) => r.path)).toEqual([
      "test/a.test.ts",
      "test/c.test.ts",
      "test/b.test.ts",
      "test/d.test.ts",
    ]);
  });

  it("keeps one entry per test file with the most urgent priority and its first position", () => {
    const queue = new RunQueue();
    queue.add(ref("test/a.test.ts"), Priority.transitive);
    queue.add(ref("test/b.test.ts"), Priority.transitive);
    queue.add(ref("test/a.test.ts"), Priority.neverRun);
    expect(queue.size).toBe(2);
    expect(queue.ordered().map((r) => r.path)).toEqual(["test/a.test.ts", "test/b.test.ts"]);
    queue.add(ref("test/b.test.ts"), Priority.direct);
    expect(queue.ordered().map((r) => r.path)).toEqual(["test/b.test.ts", "test/a.test.ts"]);
  });

  it("runs the shortest last known duration first within a class, unknown durations last", () => {
    const queue = new RunQueue();
    const durations = new Map<string, number>([
      ["test/slow.test.ts", 47_000],
      ["test/fast.test.ts", 12],
      ["test/mid.test.ts", 900],
      ["test/direct-slow.test.ts", 5_000],
    ]);
    queue.add(ref("test/unknown.test.ts"), Priority.transitive);
    queue.add(ref("test/slow.test.ts"), Priority.transitive);
    queue.add(ref("test/fast.test.ts"), Priority.transitive);
    queue.add(ref("test/mid.test.ts"), Priority.transitive);
    queue.add(ref("test/direct-slow.test.ts"), Priority.direct);
    expect(queue.ordered((r) => durations.get(r.path) ?? null).map((r) => r.path)).toEqual([
      // A class always wins over a duration.
      "test/direct-slow.test.ts",
      "test/fast.test.ts",
      "test/mid.test.ts",
      "test/slow.test.ts",
      "test/unknown.test.ts",
    ]);
    // Without durations: priority, then first queued.
    expect(queue.ordered().map((r) => r.path)).toEqual([
      "test/direct-slow.test.ts",
      "test/unknown.test.ts",
      "test/slow.test.ts",
      "test/fast.test.ts",
      "test/mid.test.ts",
    ]);
  });

  it("runs recent work ahead of a backlog, each group in D5's order (task 001-100, defect 19)", () => {
    const queue = new RunQueue();
    const durations = new Map<string, number>([
      ["test/edited-slow.test.ts", 5_000],
      ["test/edited-fast.test.ts", 10],
    ]);
    queue.add(ref("test/backlog-failing.test.ts"), Priority.failing);
    queue.add(ref("test/backlog-direct.test.ts"), Priority.direct);
    queue.add(ref("test/edited-slow.test.ts"), Priority.direct, false, true);
    queue.add(ref("test/edited-fast.test.ts"), Priority.transitive, false, true);
    queue.add(ref("test/edited-failing.test.ts"), Priority.failing, false, true);
    // A backlog entry an edit reaches becomes recent and stays so.
    queue.add(ref("test/backlog-later.test.ts"), Priority.neverRun);
    queue.add(ref("test/backlog-later.test.ts"), Priority.neverRun, false, true);
    queue.add(ref("test/backlog-later.test.ts"), Priority.neverRun);
    expect(queue.ordered((r) => durations.get(r.path) ?? null).map((r) => r.path)).toEqual([
      "test/edited-failing.test.ts",
      "test/edited-slow.test.ts",
      "test/edited-fast.test.ts",
      "test/backlog-later.test.ts",
      "test/backlog-failing.test.ts",
      "test/backlog-direct.test.ts",
    ]);
  });

  it("tells projects apart and remembers a forced entry", () => {
    const queue = new RunQueue();
    queue.add(ref("test/a.test.ts", "unit"), Priority.transitive);
    queue.add(ref("test/a.test.ts", "e2e"), Priority.transitive, true);
    queue.add(ref("test/a.test.ts", "e2e"), Priority.transitive);
    expect(queue.size).toBe(2);
    expect(queue.isForced(ref("test/a.test.ts", "e2e"))).toBe(true);
    expect(queue.isForced(ref("test/a.test.ts", "unit"))).toBe(false);
    expect(queue.remove(ref("test/a.test.ts", "unit"))).toBe(true);
    expect(queue.remove(ref("test/a.test.ts", "unit"))).toBe(false);
    expect(queue.has(ref("test/a.test.ts", "e2e"))).toBe(true);
  });
});

describe("priorityOf (D5 step 4)", () => {
  const changed = new Set(["src/math.ts", "test/b.test.ts"]);

  it("puts a last known fail first, even when inherited and not changed", () => {
    const file = newFileState(ref("test/a.test.ts"));
    file.failing = true;
    expect(priorityOf(file, changed)).toBe(Priority.failing);
  });

  it("puts a test file that itself changed before transitively affected ones", () => {
    const direct = newFileState(ref("test/b.test.ts"));
    const affected = newFileState(ref("test/a.test.ts"));
    affected.resultKey = "k-old";
    expect(priorityOf(direct, changed)).toBe(Priority.direct);
    expect(priorityOf(affected, changed)).toBe(Priority.transitive);
  });

  it("puts a direct importer from the runner's module graph before transitive ones (lessons defect 3)", () => {
    const importer = newFileState(ref("test/a.test.ts"));
    importer.resultKey = "k-old";
    const viaBarrel = newFileState(ref("test/c.test.ts"));
    viaBarrel.resultKey = "k-old";
    const direct = new Set([importer.id]);
    expect(priorityOf(importer, changed, direct)).toBe(Priority.direct);
    expect(priorityOf(viaBarrel, changed, direct)).toBe(Priority.transitive);
    // A new test file of the edited module is direct too, never-run or not.
    expect(priorityOf(newFileState(ref("test/a.test.ts")), changed, direct)).toBe(Priority.direct);
    const failing = newFileState(ref("test/a.test.ts"));
    failing.failing = true;
    expect(priorityOf(failing, changed, direct)).toBe(Priority.failing);
  });

  it("puts never-run files last", () => {
    expect(priorityOf(newFileState(ref("test/a.test.ts")), changed)).toBe(Priority.neverRun);
  });

  it("names the classes of spec 001 D5 step 4, most urgent first", () => {
    expect(Priority).toEqual({ failing: 0, direct: 1, transitive: 2, neverRun: 3 });
  });
});

describe("classify (D5 validity)", () => {
  const file = (patch: Partial<ReturnType<typeof newFileState>>) =>
    Object.assign(newFileState(ref("test/a.test.ts")), patch);

  it("is current when results exist under the current key", () => {
    expect(classify(file({ key: "k1", resultKey: "k1" }))).toBe("current");
  });

  it("is stale when results exist only under an older key", () => {
    expect(classify(file({ key: "k2", resultKey: "k1" }))).toBe("stale");
  });

  it("is unknown while unkeyed or blocked by a runner failure (D5, D6)", () => {
    expect(classify(file({ key: null, resultKey: "k1" }))).toBe("unknown");
    expect(classify(file({ key: "k1", resultKey: "k1", blocked: "runner failed" }))).toBe(
      "unknown",
    );
  });

  it("is unknown with no result at all", () => {
    expect(classify(file({ key: "k1" }))).toBe("unknown");
  });

  it("is pending while queued or running, whatever the results", () => {
    expect(classify(file({ key: "k2", resultKey: "k1", phase: "queued" }))).toBe("pending");
    expect(classify(file({ key: "k1", phase: "running" }))).toBe("pending");
  });

  it("is unknown after a crash at the current key, and stale again once the key moves on", () => {
    expect(classify(file({ key: "k1", resultKey: "k0", unknownKey: "k1" }))).toBe("unknown");
    expect(classify(file({ key: "k2", resultKey: "k0", unknownKey: "k1" }))).toBe("stale");
  });
});

describe("RunQueue's slow class (spec 004 D2)", () => {
  const isSlow = (r: TestFileRef) => r.path.startsWith("test/e2e/");

  it("keeps slow files out of the fast order and holds them in their own", () => {
    const queue = new RunQueue();
    queue.setSlow(isSlow);
    queue.add(ref("test/e2e/b.test.ts"), Priority.direct, false, true);
    queue.add(ref("test/unit.test.ts"), Priority.neverRun);
    queue.add(ref("test/e2e/a.test.ts"), Priority.failing);
    expect(queue.ordered().map((r) => r.path)).toEqual(["test/unit.test.ts"]);
    // Recent first, as in the fast class; then priority.
    expect(queue.orderedSlow().map((r) => r.path)).toEqual([
      "test/e2e/b.test.ts",
      "test/e2e/a.test.ts",
    ]);
    expect(queue.size).toBe(3);
    expect(queue.fastSize).toBe(1);
    expect(queue.slowSize).toBe(2);
  });

  it("does not count a recent slow file as an edit's fast work", () => {
    const queue = new RunQueue();
    queue.setSlow(isSlow);
    queue.add(ref("test/e2e/a.test.ts"), Priority.direct, false, true);
    expect(queue.hasRecent()).toBe(false);
    queue.add(ref("test/unit.test.ts"), Priority.direct, false, true);
    expect(queue.hasRecent()).toBe(true);
  });

  it("reads the predicate at query time, so a policy reload moves files between classes", () => {
    const queue = new RunQueue();
    queue.add(ref("test/e2e/a.test.ts"), Priority.direct);
    expect(queue.fastSize).toBe(1);
    queue.setSlow(isSlow);
    expect(queue.fastSize).toBe(0);
    expect(queue.orderedSlow()).toHaveLength(1);
  });
});
