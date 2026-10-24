import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { WT } from "../../state/helpers.js";
import { consumer, type Rig, rig } from "./rig.js";

/*
 * Spec 015 D4, D6 (review 0.1.283, B5): an edit that overtakes a count. The
 * stat cache names one blob, the disk already holds the next edit, so the
 * pass keeps the last judged state and reads the file again later. The old
 * bodies at that later pass are the ones the kept state was judged on, not
 * those of the blob the pass could not count.
 */

const C1 = consumer("s1");
const SETTLE =
  "STILL FAIL complexity: settle (src/a.ts:1) is 25 after the edit; it was already over 20 before it (ESLint rule)";

let r: Rig;

beforeEach(async () => {
  r = rig();
  await r.edit({ "src/a.ts": "settle 23 B1\npay 3 B2\n" });
  await r.register(C1);
});

/** The stat cache stores a revision of `seen`, but the disk holds `now` before the pass reads it. */
async function overtaken(seen: Record<string, string>, now: Record<string, string>) {
  for (const [path, text] of Object.entries(seen)) r.tree.write(path, text);
  r.tree.revise();
  for (const [path, text] of Object.entries(now)) writeFileSync(join(r.tree.root, path), text);
  return r.pass();
}

describe("an edit that overtakes a count (015 D4, D6; review 0.1.283 B5)", () => {
  it("keeps the judged state, then tells the first edit once and the next delivery nothing", async () => {
    const skipped = await overtaken(
      { "src/a.ts": "settle 24 B3\npay 3 B2\n" },
      { "src/a.ts": "settle 25 B4\npay 3 B2\n" },
    );
    expect(skipped).toMatchObject({ counted: 0, transitions: 0, edited: [] });
    expect(r.retry).toEqual(new Set(["src/a.ts"]));
    expect(await r.told(C1)).toEqual([]);
    const retried = await r.edit({ "src/a.ts": "settle 25 B4\npay 3 B2\n" });
    expect(retried?.edited.map((c) => c.qualifiedName)).toEqual(["settle"]);
    expect(await r.told(C1)).toEqual([SETTLE]);
    expect(await r.told(C1)).toEqual([]);
    await r.edit({ "src/a.ts": "settle 26 B5\npay 3 B2\n" });
    expect(await r.told(C1)).toEqual([]);
  });

  it("matches a move on the retry by the body the kept state was judged on (D2)", async () => {
    await overtaken(
      { "src/a.ts": "settle 23 B1\npay 4 B6\n" },
      { "src/a.ts": "pay 4 B6\n", "src/b.ts": "settle 23 B1\n" },
    );
    const retried = await r.edit({ "src/a.ts": "pay 4 B6\n", "src/b.ts": "settle 23 B1\n" });
    expect(retried).toMatchObject({ moved: 1, transitions: 0 });
    const moved = {
      kind: "code",
      path: "src/b.ts",
      qualifiedName: "settle",
      occurrence: 0,
    } as const;
    expect(r.store.states.list(WT, { outcome: "fail" }).map((s) => s.check)).toEqual([moved]);
    expect(r.store.transitions.history(WT, { ...moved, path: "src/a.ts" })).toEqual([]);
    expect(await r.told(C1)).toEqual([]);
  });
});
