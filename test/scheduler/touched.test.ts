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
