import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import { publishPromotions } from "../../src/core/scheduler/promotions.js";
import { publishQuiet, quietMetaKey } from "../../src/core/scheduler/quiet.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { timeText } from "../../src/core/text.js";
import { A, B, C, NOW, ref, repoWith } from "../cli/status-wait-fixture.js";

/*
 * Row 011-94, test 7 of `tasks/011-82/design.md` row A (spec 011 C6 as
 * amended 2026-10-21): while a lane waits for quiet after its backlog tier's
 * cancel, status lists the files the wait keeps queued as one `Outstanding:`
 * group with when it ends and `squeal run --all`, and `--json` carries
 * `quietUntil`. With no `quiet` row, from an older daemon, the text is
 * today's: a queued backlog with nothing said reads as a stuck daemon.
 */

const UNTIL = NOW + 15_000;

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

describe("status names a lane's wait for quiet (row 011-94)", () => {
  it("lists the files it keeps queued as one group, with its end and `squeal run --all`", () => {
    const { repo, store } = repoWith([A, B, C]);
    publishQuiet(store, repo.mainId, new Map([["vitest", UNTIL]]), NOW - 1_000);

    expect(outstanding(repo.main)).toEqual([
      `  3 test files queued: the vitest lane waits for quiet until ${timeText(UNTIL)}, 20 s after the last edit that queued a file of it, since an edit cancelled its backlog tier: src/a.test.ts, src/b.test.ts, src/c.test.ts; \`squeal run --all\` ends the wait`,
    ]);
    const [group] = status(repo.main).outstanding ?? [];
    expect(group?.standing).toEqual({
      kind: "queued",
      lane: "vitest",
      behind: null,
      quietUntil: UNTIL,
    });
    expect(JSON.parse(JSON.stringify(status(repo.main))).outstanding[0].standing.quietUntil).toBe(
      UNTIL,
    );
  });

  it("leaves a promoted file out of the wait's group", () => {
    const { repo, store } = repoWith([A, B]);
    publishQuiet(store, repo.mainId, new Map([["vitest", UNTIL]]), NOW - 1_000);
    publishPromotions(
      store,
      repo.mainId,
      [{ files: [testFileId(ref(A))], until: NOW + 60_000 }],
      NOW,
    );

    const lines = outstanding(repo.main);
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.includes("waits for quiet"))).toMatch(
      /1 test file queued: .*: src\/b\.test\.ts;/,
    );
    expect(lines.find((l) => l.includes("promoted"))).toMatch(/src\/a\.test\.ts/);
  });

  it("with no `quiet` row, a wait that ended, or a predecessor's row, the text is today's", () => {
    const { repo, store } = repoWith([A]);
    const today = outstanding(repo.main);
    expect(today).toEqual([
      "  1 test file queued; no run is open and nothing recorded holds it: src/a.test.ts; the store records no reason the daemon has not taken it (`squeal status --json` lists each file's state)",
    ]);
    expect(status(repo.main).outstanding?.[0]?.standing).not.toHaveProperty("quietUntil");

    publishQuiet(store, repo.mainId, new Map([["vitest", NOW]]), NOW - 20_000);
    expect(outstanding(repo.main)).toEqual(today);
    // Written before the live daemon started (`NOW - 60_000`): its predecessor's.
    publishQuiet(store, repo.mainId, new Map([["vitest", UNTIL]]), NOW - 120_000);
    expect(outstanding(repo.main)).toEqual(today);
    store.meta.delete(quietMetaKey(repo.mainId));
    expect(outstanding(repo.main)).toEqual(today);
  });
});
