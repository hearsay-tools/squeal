import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Priority, RunQueue } from "../../src/core/scheduler/queue.js";
import { fsRankSource, SlowRanker } from "../../src/core/slow/rank.js";
import type { TestFileRef } from "../../src/core/types/index.js";

/*
 * Task 004-82: the replays of `research/issue-4-signals.md` E1, E4 and E5 on
 * cezarion's slow specs, reduced to their token lines by
 * `tasks/004-82/replay-fixture.mjs`. Every spec is queued as a transitive
 * slow file with its CI duration, as a web edit queues all of them.
 */

interface Edit {
  readonly id: string;
  readonly changed: string;
  readonly specs: readonly string[];
  readonly durations: Readonly<Record<string, number | null>>;
  readonly files: Readonly<Record<string, string>>;
}
const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/slow-rank/replay.json"), "utf8"),
) as { edits: Edit[] };
const edit = (id: string) => fixture.edits.find((e) => e.id === id) as Edit;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function replay(e: Edit, ranked: boolean): string[] {
  const root = mkdtempSync(join(tmpdir(), "squeal-rank-replay-"));
  dirs.push(root);
  for (const [path, text] of Object.entries(e.files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const ranker = new SlowRanker(fsRankSource(root));
  const queue = new RunQueue();
  queue.setSlow(() => true);
  const refs: TestFileRef[] = e.specs.map((path) => ({ project: "web", path }));
  for (const ref of refs) queue.add(ref, Priority.transitive, false, true);
  if (ranked) {
    const evidence = ranker.evidence(new Set([e.changed]), e.specs);
    for (const ref of refs) queue.addEvidence(ref, evidence.get(ref.path) ?? []);
  }
  return queue
    .orderedSlow((ref) => e.durations[ref.path] ?? null, ranked)
    .map((ref) => ref.path.slice("packages/web/e2e/".length));
}

const at = (order: readonly string[], name: string) => order.indexOf(name) + 1;

describe("slow files ranked by evidence: the issue-4 replays (004 D2, task 004-82)", () => {
  it("E1, #1076's markdown.tsx edit: its spec runs 1st of 76, 64th by duration alone", () => {
    const e = edit("E1");
    expect(e.specs).toHaveLength(76);
    expect(at(replay(e, false), "artifact-project-links.e2e.ts")).toBe(64);
    expect(at(replay(e, true), "artifact-project-links.e2e.ts")).toBe(1);
  });

  it("E5, #966's accessibility.css edit: the specs its author extended run in the top 4", () => {
    const e = edit("E5");
    const order = replay(e, true);
    expect(at(order, "good-css.e2e.ts")).toBeLessThanOrEqual(4);
    expect(at(order, "task-thread.e2e.ts")).toBeLessThanOrEqual(4);
    expect(at(replay(e, false), "good-css.e2e.ts")).toBe(53);
  });

  it("E4, a build-script edit: no spec gains evidence and the order is the duration order", () => {
    const e = edit("E4");
    expect(replay(e, true)).toEqual(replay(e, false));
  });

  it("every queued slow file is still in the order: ranking only reorders", () => {
    for (const e of fixture.edits) {
      expect(replay(e, true).sort()).toEqual(
        e.specs.map((p) => p.slice("packages/web/e2e/".length)).sort(),
      );
    }
  });
});
