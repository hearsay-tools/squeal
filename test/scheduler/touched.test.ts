import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { InvalidatedPath } from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Task 001-159: a batch that rewrote a file with the bytes it had names no
 * revision, and still reaches the runner, as `kind: "touch"`, before the next
 * tier. Only a stat that moved counts: a racy entry re-hashed on an equal
 * stat was not written, and a file that came and went in one batch (an
 * editor's temp file) was never known.
 */

async function open(): Promise<{ h: Harness; calls: InvalidatedPath[][] }> {
  const repo = createRepo();
  const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir);
  await h.scheduler.start();
  await h.scheduler.idle();
  const calls: InvalidatedPath[][] = [];
  const invalidate = h.runner.invalidate;
  h.runner.invalidate = (paths) => {
    calls.push([...paths]);
    return invalidate(paths);
  };
  return { h, calls };
}

const latest = (h: Harness) => h.store.revisions.latest(h.worktreeId)?.number ?? 0;
const rewrite = (h: Harness, path: string) =>
  h.write(path, readFileSync(join(h.root, path), "utf8"));
const touches = (calls: InvalidatedPath[][]) => calls.flat().filter((p) => p.kind === "touch");

describe("scheduler: a touched file whose bytes ended unchanged (task 001-159)", () => {
  it("is handed to the runner as a touch, with no revision", SLOW, async () => {
    const { h, calls } = await open();
    const revision = latest(h);
    rewrite(h, "src/math.ts");
    await h.batch("src/math.ts");
    await h.scheduler.idle();

    expect(latest(h)).toBe(revision);
    expect(calls).toEqual([[{ path: "src/math.ts", kind: "touch" }]]);
  });

  // The revert-restore integration test's timeout: a touch reported every project recreated,
  // so its refinement listed the test files and hashed one added after the touch, whose own
  // batch then found nothing changed. No revision ever named it.
  it("lists no test file, so one added meanwhile still makes its revision", SLOW, async () => {
    const { h } = await open();
    const revision = latest(h);
    rewrite(h, "src/math.ts");
    h.write("test/added.test.ts", 'import { it } from "vitest";\nit("passes", () => {});\n');
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    await h.batch("test/added.test.ts");
    await h.scheduler.idle();

    expect(latest(h)).toBe(revision + 1);
    expect(h.runsOf("test/added.test.ts")).toHaveLength(1);
  });

  it("goes with the changes of its batch in one call", SLOW, async () => {
    const { h, calls } = await open();
    rewrite(h, "src/math.ts");
    h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase() + '';\n");
    await h.batch("src/math.ts", "src/strings.ts");
    await h.scheduler.idle();

    expect(calls).toEqual([
      [
        { path: "src/strings.ts", kind: "change" },
        { path: "src/math.ts", kind: "touch" },
      ],
    ]);
  });

  it("waits as one call while the runner work before it waits", SLOW, async () => {
    const { h, calls } = await open();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    // The recorder queues the runner part behind this run, as a serializing runner does.
    h.runner.beforeRun = async () => {
      started();
      await held;
    };
    h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase() + '';\n");
    await h.batch("src/strings.ts");
    await running;
    for (const path of ["src/math.ts", "src/strings.ts", "src/math.ts"]) {
      rewrite(h, path);
      await h.batch(path);
    }
    release();
    await h.scheduler.idle();

    // The first touch is the runner work under way; the next two wait behind it as one.
    expect(calls).toEqual([
      [{ path: "src/strings.ts", kind: "change" }],
      [{ path: "src/math.ts", kind: "touch" }],
      [
        { path: "src/math.ts", kind: "touch" },
        { path: "src/strings.ts", kind: "touch" },
      ],
    ]);
  });

  it("is not an editor's temp file that came and went", SLOW, async () => {
    const { h, calls } = await open();
    h.write("src/math.ts.tmp.1234.abcd", "export const x = 1;\n");
    h.remove("src/math.ts.tmp.1234.abcd");
    await h.batch("src/math.ts.tmp.1234.abcd");
    await h.scheduler.idle();

    expect(touches(calls)).toEqual([]);
  });

  it("is not a racy entry re-hashed on the stat it was hashed with", SLOW, async () => {
    const { h, calls } = await open();
    h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase() + '';\n");
    await h.batch("src/strings.ts");
    // Hashed within the racy window of its write, so hashed again; nothing wrote it since.
    await h.scheduler.handleBatch({ trigger: "interval", paths: [] });
    await h.batch("src/strings.ts");
    await h.scheduler.idle();

    expect(touches(calls)).toEqual([]);
  });
});
