import { describe, expect, it } from "vitest";
import { Priority, RunQueue } from "../../src/core/scheduler/queue.js";
import type { TestFileRef } from "../../src/core/types/index.js";

const ref = (path: string): TestFileRef => ({ project: "", path });

/*
 * Issue 31 (011 C4 step 4 as amended 2026-10-18, task 011-17): a test file
 * the revision itself added or edited ranks ahead of the other direct
 * importers of a changed path, after failures, and an unknown duration sorts
 * as the shortest. `research/issue-31.md`, scenario F: harness-parity's tier
 * is running, monitoring-turn imports the edited `run.ts` directly.
 */
describe("RunQueue: an edited test file before broad dependent suites (gh-31)", () => {
  const durations = new Map<string, number>([
    ["test/monitoring-turn.test.ts", 480_000],
    ["test/short-importer.test.ts", 6_000],
    ["test/failing.test.ts", 540_000],
    ["test/edited-known.test.ts", 20_000],
  ]);
  const durationOf = (r: TestFileRef) => durations.get(r.path) ?? null;
  const paths = (queue: RunQueue) => queue.ordered(durationOf).map((r) => r.path);

  it("runs an edited file of unknown duration before a long direct importer (scenario F)", () => {
    const queue = new RunQueue();
    queue.add(ref("test/monitoring-turn.test.ts"), Priority.direct, false, true);
    queue.add(ref("src/workflows/worker-wait-durability.test.ts"), Priority.edited, false, true);
    expect(paths(queue)).toEqual([
      "src/workflows/worker-wait-durability.test.ts",
      "test/monitoring-turn.test.ts",
    ]);
  });

  it("keeps failures first and every queued file in the order", () => {
    const queue = new RunQueue();
    queue.add(ref("test/short-importer.test.ts"), Priority.direct, false, true);
    queue.add(ref("test/monitoring-turn.test.ts"), Priority.direct, false, true);
    queue.add(ref("test/edited-known.test.ts"), Priority.edited, false, true);
    queue.add(ref("test/edited-unknown.test.ts"), Priority.edited, false, true);
    queue.add(ref("test/failing.test.ts"), Priority.failing, false, true);
    queue.add(ref("test/transitive.test.ts"), Priority.transitive, false, true);
    expect(paths(queue)).toEqual([
      "test/failing.test.ts",
      "test/edited-unknown.test.ts",
      "test/edited-known.test.ts",
      "test/short-importer.test.ts",
      "test/monitoring-turn.test.ts",
      "test/transitive.test.ts",
    ]);
  });

  it("leaves an unknown duration last in the other classes", () => {
    const queue = new RunQueue();
    queue.add(ref("test/unknown-importer.test.ts"), Priority.direct, false, true);
    queue.add(ref("test/monitoring-turn.test.ts"), Priority.direct, false, true);
    expect(paths(queue)).toEqual(["test/monitoring-turn.test.ts", "test/unknown-importer.test.ts"]);
  });

  it("keeps an edited file's rank while it waits, whatever re-queues it", () => {
    const queue = new RunQueue();
    queue.add(ref("test/monitoring-turn.test.ts"), Priority.direct, false, true);
    queue.add(ref("test/edited.test.ts"), Priority.edited, false, true);
    queue.add(ref("test/edited.test.ts"), Priority.neverRun);
    expect(paths(queue)[0]).toBe("test/edited.test.ts");
  });
});
