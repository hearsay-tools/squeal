import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import type { CatchUpFile, CatchUpSide } from "./catch-up-fixture.js";
import { ranPaths } from "./group-lanes-fixture.js";
import { heldSide } from "./take-back-fixture.js";

/*
 * Review wave-20 B1 (row 023-34, T1): a take-back removes only what the
 * call's requests alone need. 0.1.586 kept an entry only when it was
 * recent, forced or promoted elsewhere; an edit's catch-up (ten keyed
 * paths in one revision) and readers the edit cut demotes are none of
 * those, so it took them back: the review's witness answered
 * `{takenBack: 11, running: 1, kept: 0}` after ten sources were edited.
 */

const ms = (i: number) => 10 + i;
const name = (i: number) => String(i).padStart(2, "0");

/** Twelve files of the manual group, each importing its own source. */
const OWN: readonly CatchUpFile[] = Array.from({ length: 12 }, (_, i) => ({
  path: `test/browser/f${name(i)}.test.ts`,
  ms: ms(i),
  imports: [`src/s${name(i)}.ts`],
}));

/** Twelve files of the manual group, all importing one source. */
const SHARED: readonly CatchUpFile[] = Array.from({ length: 12 }, (_, i) => ({
  path: `test/browser/g${name(i)}.test.ts`,
  ms: ms(i),
  imports: ["src/shared.ts"],
}));

/** The test files `side` holds queued now, by the pending phase it stored. */
function queuedPaths(side: CatchUpSide): string[] {
  return side.store.testFileKeys
    .list(side.worktreeId)
    .filter((row) => row.pending === "queued")
    .map((row) => row.testFile.path)
    .sort();
}

/** Requests every file of `files` for owner `o1`; the first runs, held. */
async function requested(files: readonly CatchUpFile[]) {
  const { side, gate } = await heldSide(files);
  const paths = files.map((f) => f.path);
  const request = await side.scheduler.requestGroupPaths?.("browser", paths, { owner: "o1" });
  expect(request).toMatchObject({ queued: files.length });
  await expect.poll(() => side.runner.runs.length, { timeout: 20_000 }).toBe(1);
  const started = ranPaths(side);
  expect(started).toHaveLength(1);
  return { side, gate, started: started[0] ?? "" };
}

describe("a take-back keeps what an edit needs (review wave-20 B1)", { timeout: 120_000 }, () => {
  it("keeps the ten files an edit of ten sources queued as catch-up", async () => {
    const { side, gate, started } = await requested(OWN);
    const queued = OWN.filter((f) => f.path !== started);
    const edited = queued.slice(0, 10);
    const untouched = queued.slice(10);
    await side.edit("watch", ...edited.flatMap((f) => f.imports ?? []));
    expect(await side.scheduler.takeBack?.(["o1"])).toEqual({
      takenBack: untouched.length,
      running: 1,
      kept: 10,
    });
    // The edit's work stays queued (a manual group's re-keyed files wait for their moment).
    expect(queuedPaths(side)).toEqual(edited.map((f) => f.path).sort());
    gate.stop();
    await side.rest();
    await delay(300);
    for (const f of untouched) expect(ranPaths(side)).not.toContain(f.path);
  });

  it("keeps the readers an edit of their shared source queued, demoted or not", async () => {
    const { side, gate, started } = await requested(SHARED);
    await side.edit("watch", "src/shared.ts");
    expect(await side.scheduler.takeBack?.(["o1"])).toEqual({
      takenBack: 0,
      running: 1,
      kept: 11,
    });
    // Every reader stays queued (the running one too: the edit queued it again).
    const others = SHARED.map((f) => f.path).filter((path) => path !== started);
    expect(queuedPaths(side)).toEqual(expect.arrayContaining(others));
    gate.stop();
  });

  it("still takes back what an unrelated edit did not touch", async () => {
    const { side, gate } = await requested(OWN.slice(0, 3));
    // A source none of the queued files reads.
    await side.edit("watch", OWN[0]?.imports?.[0] ?? "");
    expect(await side.scheduler.takeBack?.(["o1"])).toMatchObject({ takenBack: 2, running: 1 });
    gate.stop();
  });
});
