import { describe, expect, it } from "vitest";
import { readRefined } from "../../src/core/scheduler/refined.js";
import type { InvalidatedPath } from "../../src/core/types/runner.js";
import { SLOW } from "./cleanup.js";
import { createRepo, openRepoStore } from "./repo.js";
import { type Harness, openHarness } from "./vitest-harness.js";

/*
 * Row 011-396 (gh-181, research `stuck-running.md` E4b): while edits come
 * faster than the runner lists them, the daemon lists only the newest
 * revision beside the one in flight, as a restart does (E4c), and no tier
 * starts before the newest is listed.
 *
 * Fixture `barrel`: `test/barrel.test.ts` imports `src/index.ts`, which
 * re-exports `src/math.ts` and `src/strings.ts`; `test/math.test.ts`.
 */

const TEST = (name: string) => `import { it } from "vitest";\n\nit("${name}", () => {});\n`;
const KEPT = "test/kept.test.ts";
const GONE = "test/gone.test.ts";

async function started(): Promise<Harness> {
  const repo = createRepo("barrel");
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1 });
  await h.scheduler.start();
  await h.quiet();
  return h;
}

/** Revision `i` of the stream: an edit of a source, and the test files it adds or deletes. */
async function revise(h: Harness, i: number): Promise<void> {
  const source = i % 2 === 0 ? "src/strings.ts" : "src/math.ts";
  const body =
    i % 2 === 0
      ? `export const upper = (s: string) => s.toUpperCase() + "${"".padEnd(i, "!")}";\n`
      : `export const add = (a: number, b: number) => a + b + ${i} - ${i};\n`;
  h.write(source, body);
  const paths = [source];
  if (i === 3) h.write(KEPT, TEST("is kept"));
  if (i === 3) paths.push(KEPT);
  if (i === 5) h.write(GONE, TEST("is gone"));
  if (i === 5) paths.push(GONE);
  if (i === 9) h.remove(GONE);
  if (i === 9) paths.push(GONE);
  await h.batch(...paths);
}

describe("scheduler: a stream of edits lists only its newest revision (row 011-396)", SLOW, () => {
  it("lists the revision in flight and the newest of 20, keeps the stream's test files, then runs", async () => {
    const h = await started();
    const order: string[] = [];
    const invalidated: (readonly InvalidatedPath[])[] = [];
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const invalidate = h.runner.invalidate;
    h.runner.invalidate = async (paths) => {
      invalidated.push(paths);
      order.push("invalidate");
      // The first revision's runner part is in flight until the stream ends.
      if (invalidated.length === 1) await held;
      return invalidate(paths);
    };
    const testFiles = h.runner.testFiles;
    h.runner.testFiles = async () => {
      const listed = await testFiles();
      order.push("listed");
      return listed;
    };
    h.runner.beforeRun = (files) => {
      order.push(`run ${files.map((f) => f.path).join(" ")}`);
    };

    for (let i = 0; i < 20; i++) await revise(h, i);
    expect(invalidated).toHaveLength(1);
    release();
    await h.quiet();

    // The one in flight and the newest: two runner parts for 20 revisions, at most two listings.
    expect(invalidated).toHaveLength(2);
    expect(order.filter((step) => step === "listed").length).toBeLessThanOrEqual(2);
    const kinds = new Map((invalidated[1] ?? []).map((p) => [p.path, p.kind]));
    expect(kinds.get(KEPT)).toBe("add");
    expect(kinds.get(GONE)).toBe("delete");
    expect(kinds.get("src/math.ts")).toBe("change");
    // Added and kept is listed; added and deleted in between is not.
    expect(h.keyOf(KEPT)).not.toBeNull();
    expect(h.keyOf(GONE)).toBeNull();
    // Tiers start only after the newest revision is listed.
    const runs = order.flatMap((step, at) => (step.startsWith("run ") ? [at] : []));
    expect(runs.length).toBeGreaterThan(0);
    expect(Math.min(...runs)).toBeGreaterThan(order.lastIndexOf("listed"));
    expect(order.filter((step) => step.startsWith("run ")).join(" ")).toContain(KEPT);
    // The newest revision is refined, which counts every superseded one refined.
    expect(readRefined(h.store, h.worktreeId)).toBe(h.scheduler.status().revision);
  });
});
