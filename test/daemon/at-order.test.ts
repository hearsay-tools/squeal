import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atOrder } from "../../src/core/daemon/at-asks.js";
import type { RelativePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "../scheduler/catch-up-fixture.js";
import { ranPaths } from "../scheduler/group-lanes-fixture.js";
import { heldSide } from "../scheduler/held-side-fixture.js";

/*
 * Row 023-68 (dogfood round 8 X3): one `status --at --run` call queued the
 * same browser files on both daemons, and they ran them in different orders
 * (the commit side `activity`, `artifact-project-links`, …; the working tree
 * `agent-browser-tabs`, `chat-code-fence`, …), so no file had both sides.
 * Each daemon ordered its batch by its own stored durations and queue order.
 * Now a `status --at --run` request's batch keeps the request's order, and
 * the call sends both daemons one order (`atOrder`).
 */

const TIMEOUT = 20_000;
const path = (i: number) => `test/f${String(i).padStart(2, "0")}.test.ts`;
/** Twelve files; the later the longer, so longest first would reverse them. */
const OF: CatchUpFile[] = Array.from({ length: 12 }, (_, i) => ({
  path: path(i),
  ms: (i + 1) * 1_000,
  realMs: 0,
  imports: [`src/s${i}.ts`],
}));
/** The call's order: named files first, then the others by path. */
const CALL = [7, 2, 0, 1, 3, 4, 5, 6, 8, 9, 10, 11].map(path) as RelativePath[];

const options = { files: OF, hostSlots: 4, policy: { baseline: { onStart: "lookup-only" } } };

/** The commit side: another worktree stored each file's duration; its own keys differ. */
async function withDurations(): Promise<CatchUpSide> {
  const repo = catchUpRepo(OF);
  const other = catchUpSide(repo, repo.other, { ...options, policy: RUN_MISSING });
  await other.scheduler.start();
  await expect.poll(() => OF.every((f) => other.current(f.path)), { timeout: TIMEOUT }).toBe(true);
  appendFileSync(join(repo.main, "config.json"), "// the commit\n");
  const side = catchUpSide(repo, repo.main, options as never);
  await side.scheduler.start();
  await side.rest();
  return side;
}

/** The working tree: an empty store, no duration known. */
async function withoutDurations(): Promise<CatchUpSide> {
  const repo = catchUpRepo(OF);
  const side = catchUpSide(repo, repo.main, options as never);
  await side.scheduler.start();
  await side.rest();
  return side;
}

/** The order `side` ran the files in once the request is done. */
async function ranOrder(side: CatchUpSide): Promise<string[]> {
  await side.scheduler.requestGroupPaths?.("tests", CALL, { at: true });
  await expect.poll(() => OF.every((f) => side.current(f.path)), { timeout: TIMEOUT }).toBe(true);
  return side.runner.runs.flatMap((run) => run.files.map((f) => f.path));
}

describe("both sides of a call run its files in one order (row 023-68, X3)", {
  timeout: 90_000,
}, () => {
  it("runs a status --at --run request's files in the request's order, durations known or not", async () => {
    const commit = await ranOrder(await withDurations());
    const now = await ranOrder(await withoutDurations());
    expect(commit).toEqual(CALL);
    expect(now).toEqual(CALL);
  });

  it("runs a group lane's request in the request's order (a manual group, as squawk's browser files)", async () => {
    const browser: CatchUpFile[] = Array.from({ length: 6 }, (_, i) => ({
      path: `test/browser/f${i}.test.ts`,
      ms: 10 + i,
      imports: [`src/s${i}.ts`],
    }));
    const call = [4, 1, 5, 0, 2, 3].map((i) => `test/browser/f${i}.test.ts`) as RelativePath[];
    const { side, gate } = await heldSide(browser);
    // Queued before, in path order (as the working tree's daemon held them); its first tier runs.
    const byPath = browser.map((f) => f.path);
    await side.scheduler.requestGroupPaths?.("browser", byPath);
    await expect.poll(() => side.runner.runs.length, { timeout: TIMEOUT }).toBe(1);
    // The call that names them leads, in its order.
    await side.scheduler.requestGroupPaths?.("browser", call, { at: true, lead: true });
    gate.stop();
    await expect
      .poll(() => browser.every((f) => side.current(f.path)), { timeout: TIMEOUT })
      .toBe(true);
    const [first] = byPath;
    expect(ranPaths(side)).toEqual([first, ...call.filter((p) => p !== first)]);
  });

  it("orders the call's files: named by their own path first, in the call's order, then by path", () => {
    const ref = (p: string, project = ""): TestFileRef => ({ project, path: p as RelativePath });
    const refs = [ref("b.test.ts"), ref("a.test.ts", "web"), ref("c.test.ts"), ref("a.test.ts")];
    const named = ["c.test.ts", "lib/", "b.test.ts"] as RelativePath[];
    expect(atOrder(named, refs)).toEqual([
      ref("c.test.ts"),
      ref("b.test.ts"),
      ref("a.test.ts"),
      ref("a.test.ts", "web"),
    ]);
    expect(atOrder([], refs.toReversed())).toEqual([
      ref("a.test.ts"),
      ref("a.test.ts", "web"),
      ref("b.test.ts"),
      ref("c.test.ts"),
    ]);
  });
});
