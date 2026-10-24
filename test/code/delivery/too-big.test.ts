import { beforeEach, describe, expect, it } from "vitest";
import { codeSeenUpTo } from "../../../src/core/delivery/code-since.js";
import { WT } from "../../state/helpers.js";
import { fakeCounter } from "../pass/helpers.js";
import { consumer, type Rig, rig } from "../pass/rig.js";

/*
 * Row 015-36 (lessons.md "Round 1 (015-10)" B3): a file too big to count
 * is told only for an edit to it after the session registered (D6). A
 * first count or a recount writes every files row again, which is no
 * edit, and a resumed session keeps what it was told.
 */

const C0 = consumer("s0");
const C1 = consumer("s1");
const LIMIT = 64;
/** A file over `LIMIT` bytes: `n` lines the fake counter would count. */
const big = (n: number) => `run 1 B${n}\n`.repeat(12);
const LINE = "src/big.ts is 0 KiB, over the 0 KiB limit; its functions are not counted.";
const bigLines = (lines: string[]) => lines.filter((l) => l.startsWith("src/big.ts is "));

let r: Rig;

beforeEach(() => {
  r = rig({ maxFileBytes: LIMIT });
  r.tree.write("src/a.ts", "settle 23 B1\n").write("src/big.ts", big(1)).commit();
  r.tree.revise();
});

/**
 * Stores one revision of the paths written since the last, in the main
 * store too, so a registration counts from it as the daemon's would.
 */
function revise(): number {
  const n = r.tree.revise();
  while ((r.main.revisions.latest(WT)?.number ?? 0) < n) {
    r.main.revisions.append({
      worktreeId: WT,
      createdAt: n,
      head: null,
      dirty: true,
      trigger: "watch",
      changes: [],
    });
  }
  return n;
}

/** The delivery's lines to `c` at its next tool boundary, the recount summary and the too-big lines only. */
async function summaryAndBig(c: typeof C1): Promise<string[]> {
  return (await r.delivered(c)).filter(
    (l) => l.startsWith("Complexity threshold is now ") || l.startsWith("src/big.ts is "),
  );
}

/** An edit of `path` counted by the new counter of a recount. */
function editAfterRecount(path: string, text: string) {
  r.tree.write(path, text).revise();
  return r.pass(fakeCounter(2));
}

describe("a file too big to count (015-36)", () => {
  it("tells none at a first count that ends after the registration", async () => {
    await r.register(C1);
    r.tree.write("src/a.ts", "settle 24 B2\n").revise();
    expect(await r.pass()).toMatchObject({ mode: "first" });
    const lines = await r.delivered(C1);
    expect(lines).toContain("Complexity counted: 1 function over 20; squeal code lists them.");
    expect(bigLines(lines)).toEqual([]);
  });

  it("tells none at a recount, and one at the edit to it after", async () => {
    await r.pass();
    await r.register(C1);
    r.tree.write("src/a.ts", "settle 24 B2\n").revise();
    expect(await r.pass(fakeCounter(2))).toMatchObject({ mode: "counter" });
    // The recount writes every files row at its revision, big.ts's too.
    const lines = await r.delivered(C1);
    expect(lines.some((l) => l.startsWith("Complexity counted again by a new counter"))).toBe(true);
    expect(bigLines(lines)).toEqual([]);
    expect(await r.delivered(C1)).toEqual([]);
    await editAfterRecount("src/big.ts", big(2));
    expect(bigLines(await r.delivered(C1))).toEqual([LINE]);
    await editAfterRecount("src/big.ts", big(3));
    expect(await r.delivered(C1)).toEqual([]);
  });

  it("tells an edit at a revision that recounts, and none for a file only that recount wrote (review 0.1.297 B5)", async () => {
    r.tree.write("src/huge.ts", big(9)).revise();
    await r.pass();
    await r.register(C1);
    expect(await editAfterRecount("src/big.ts", big(2))).toMatchObject({ mode: "counter" });
    const lines = await r.delivered(C1);
    expect(lines.some((l) => l.startsWith("Complexity counted again by a new counter"))).toBe(true);
    expect(lines.filter((l) => l.includes(" KiB limit;"))).toEqual([LINE]);
    expect(await r.delivered(C1)).toEqual([]);
    // Once per session: a later edit tells none, by the same counter or at a recount back to the first.
    await editAfterRecount("src/big.ts", big(3));
    expect(await r.delivered(C1)).toEqual([]);
    expect(await r.edit({ "src/big.ts": big(4) })).toMatchObject({ mode: "counter" });
    expect(bigLines(await r.delivered(C1))).toEqual([]);
  });

  it("tells an edit before a registration to the sessions before it only, at a recount after both (review 0.1.297-r2 N1)", async () => {
    revise();
    await r.pass();
    await r.register(C0);
    r.tree.write("src/big.ts", big(2));
    const edit = revise();
    await r.register(C1);
    expect(codeSeenUpTo(r.main, C1)).toEqual({ since: edit, gaps: [] });
    revise();
    expect(await r.pass(fakeCounter(), { threshold: 21 })).toMatchObject({ mode: "threshold" });
    const summary = "Complexity threshold is now 21: 1 function over; squeal code lists them.";
    expect(await summaryAndBig(C0)).toEqual([summary, LINE]);
    expect(await summaryAndBig(C1)).toEqual([summary]);
  });

  it("keeps an edit a recount found through a second recount before the delivery (review 0.1.297-r2 N1)", async () => {
    revise();
    await r.pass();
    await r.register(C0);
    r.tree.write("src/big.ts", big(2));
    revise();
    expect(await r.pass(fakeCounter(), { threshold: 21 })).toMatchObject({ mode: "threshold" });
    await r.register(C1);
    revise();
    expect(await r.pass(fakeCounter(), { threshold: 22 })).toMatchObject({ mode: "threshold" });
    const summary = "Complexity threshold is now 22: 1 function over; squeal code lists them.";
    expect(await summaryAndBig(C0)).toEqual([summary, LINE]);
    expect(await summaryAndBig(C1)).toEqual([summary]);
    expect(await r.delivered(C0)).toEqual([]);
  });

  it("tells a resumed session nothing for a file it was told of, edited again or not", async () => {
    await r.pass();
    await r.register(C1);
    await r.edit({ "src/big.ts": big(2) });
    expect(bigLines(await r.delivered(C1))).toEqual([LINE]);
    await r.end(C1);
    await r.register(C1);
    expect(await r.delivered(C1)).toEqual([]);
    await r.edit({ "src/big.ts": big(3) });
    expect(await r.delivered(C1)).toEqual([]);
  });

  it("tells a resumed session nothing after a recount it was away for, and one at its edit", async () => {
    await r.pass();
    await r.register(C1);
    await r.end(C1);
    await r.pass(fakeCounter(2));
    await r.register(C1);
    await editAfterRecount("src/a.ts", "settle 24 B2\n");
    expect(bigLines(await r.delivered(C1))).toEqual([]);
    await editAfterRecount("src/big.ts", big(2));
    expect(bigLines(await r.delivered(C1))).toEqual([LINE]);
  });
});
