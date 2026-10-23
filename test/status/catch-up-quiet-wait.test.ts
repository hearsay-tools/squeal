import { describe, expect, it } from "vitest";
import { publishQuiet } from "../../src/core/scheduler/quiet.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { timeText } from "../../src/core/text.js";
import { A, B, NOW, repoWith } from "../cli/status-wait-fixture.js";

/*
 * Row 011-153 (spec 011 C4 step 5 as amended 2026-10-23, C6): while a
 * lane's catch-up of an edit waits for quiet, status names that wait as it
 * names the wait after a cancel: one `Outstanding:` group with its end and
 * `squeal run --all`, and `quietUntil` with `quietCatchUp` in `--json`.
 * When both waits run, the group names the one that ends later.
 */

const LATER = NOW + 100_000;
const SOONER = NOW + 15_000;
const NONE: ReadonlyMap<string, number> = new Map();

function status(root: string) {
  const read = readStatus(root, { now: () => NOW });
  if (!read.available) throw new Error(read.message);
  return read;
}

/** The lines of the `Outstanding:` block, its heading left out. */
function outstanding(root: string): string[] {
  const lines = formatStatus(status(root), NOW, "squeal").split("\n");
  const at = lines.indexOf("Outstanding:");
  const end = lines.findIndex((l, i) => i > at && !l.startsWith("  "));
  return lines.slice(at + 1, end === -1 ? undefined : end);
}

const catchUpLine = (until: number) =>
  `  2 test files queued: the vitest lane waits for quiet until ${timeText(until)}, 120 s after the last edit that queued a file of it, before it runs catch-up: src/a.test.ts, src/b.test.ts; \`squeal run --all\` ends the wait`;

describe("status names a lane's wait before catch-up (row 011-153)", () => {
  it("lists the files it keeps queued as one group, with its end and `squeal run --all`", () => {
    const { repo, store } = repoWith([A, B]);
    publishQuiet(store, repo.mainId, NONE, NOW - 1_000, new Map([["vitest", LATER]]));

    expect(outstanding(repo.main)).toEqual([catchUpLine(LATER)]);
    const standing = { kind: "queued", lane: "vitest", behind: null, quietUntil: LATER };
    expect(status(repo.main).outstanding?.[0]?.standing).toEqual({
      ...standing,
      quietCatchUp: true,
    });
    const json = JSON.parse(JSON.stringify(status(repo.main)));
    expect(json.outstanding[0].standing).toMatchObject({ quietUntil: LATER, quietCatchUp: true });
  });

  it("with both waits, names the one that ends later", () => {
    const { repo, store } = repoWith([A, B]);
    const sooner = new Map([["vitest", SOONER]]);
    const later = new Map([["vitest", LATER]]);
    publishQuiet(store, repo.mainId, sooner, NOW - 1_000, later);
    expect(outstanding(repo.main)).toEqual([catchUpLine(LATER)]);

    publishQuiet(store, repo.mainId, later, NOW - 1_000, sooner);
    expect(outstanding(repo.main)).toEqual([
      `  2 test files queued: the vitest lane waits for quiet until ${timeText(LATER)}, 20 s after the last edit that queued a file of it, since an edit cancelled its backlog tier: src/a.test.ts, src/b.test.ts; \`squeal run --all\` ends the wait`,
    ]);
    expect(status(repo.main).outstanding?.[0]?.standing).not.toHaveProperty("quietCatchUp");
  });

  it("a catch-up wait that ended, or a predecessor's, says nothing", () => {
    const { repo, store } = repoWith([A]);
    const today = outstanding(repo.main);
    publishQuiet(store, repo.mainId, NONE, NOW - 1_000, new Map([["vitest", NOW]]));
    expect(outstanding(repo.main)).toEqual(today);
    // Written before the live daemon started (`NOW - 60_000`): its predecessor's.
    publishQuiet(store, repo.mainId, NONE, NOW - 120_000, new Map([["vitest", LATER]]));
    expect(outstanding(repo.main)).toEqual(today);
  });
});
