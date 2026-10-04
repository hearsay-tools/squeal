import { describe, expect, it } from "vitest";
import { classify, newFileState } from "../../src/core/scheduler/files.js";
import { Priority, priorityOf, RunQueue } from "../../src/core/scheduler/queue.js";
import type { TestFileRef } from "../../src/core/types/index.js";

const ref = (path: string, project = ""): TestFileRef => ({ project, path });

describe("RunQueue", () => {
  it("orders by priority, then by first queued, then by project and path", () => {
    const queue = new RunQueue();
    queue.add(ref("test/d.test.ts"), Priority.neverRun);
    queue.add(ref("test/c.test.ts"), Priority.affected);
    queue.add(ref("test/b.test.ts"), Priority.affected);
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
    queue.add(ref("test/a.test.ts"), Priority.affected);
    queue.add(ref("test/b.test.ts"), Priority.affected);
    queue.add(ref("test/a.test.ts"), Priority.neverRun);
    expect(queue.size).toBe(2);
    expect(queue.ordered().map((r) => r.path)).toEqual(["test/a.test.ts", "test/b.test.ts"]);
    queue.add(ref("test/b.test.ts"), Priority.direct);
    expect(queue.ordered().map((r) => r.path)).toEqual(["test/b.test.ts", "test/a.test.ts"]);
  });

  it("tells projects apart and remembers a forced entry", () => {
    const queue = new RunQueue();
    queue.add(ref("test/a.test.ts", "unit"), Priority.affected);
    queue.add(ref("test/a.test.ts", "e2e"), Priority.affected, true);
    queue.add(ref("test/a.test.ts", "e2e"), Priority.affected);
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
    expect(priorityOf(affected, changed)).toBe(Priority.affected);
  });

  it("puts never-run files last", () => {
    expect(priorityOf(newFileState(ref("test/a.test.ts")), changed)).toBe(Priority.neverRun);
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
    expect(classify(file({ key: null, resultKey: "k1" }))).toBe("stale");
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
