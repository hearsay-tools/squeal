import { describe, expect, it } from "vitest";
import { classLines, fileEntry } from "../../src/cli/named-file-lines.js";
import { daemonLiveness } from "../../src/core/delivery/liveness.js";
import { publishedYieldRow } from "../../src/core/scheduler/yields.js";
import { standingsOf } from "../../src/core/status/standing.js";
import type { TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpRepo,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { CUT_WITHIN_MS, heldRun, holdRuns, pause, ref, SETTLE_MS } from "./tier-yields-fixture.js";

/*
 * Row 011-209, `research/issue-91.md` F2 and F3 (spec 011 C15): the daemon
 * keeps its last yield per worktree, with its time, what it yielded to, its
 * rule, the files it cut and the cut run's start and end, until a later
 * tier that holds a cut file ends. Running and queued lines of its lane
 * name it. A daemon restart keeps none, and the restarted daemon's first
 * tier says so (rule C, `tasks/011-209/notes.md`). The probe's shape: four
 * 200 s files in one tier, two fast files promoted behind it.
 */
const SLOW = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
const [F, G] = ["f/f.test.ts", "f/g.test.ts"];
const PROMOTED: TestFileRef[] = [ref(F, "f"), ref(G, "f")];
const NAMED: TestFileRef[] = [...SLOW.map((path) => ref(path)), ...PROMOTED];
const FILES: CatchUpFile[] = [
  ...SLOW.map((path) => ({ path, ms: 200_000, imports: ["src/s.ts"] })),
  { project: "f", path: F, ms: 1, imports: ["src/f.ts"] },
  { project: "f", path: G, ms: 1, imports: ["src/f.ts"] },
];

const KEPT =
  /; a yield at \d\d:\d\d:\d\d cut 4 files after \d+ s of their run \(to a promoted file; estimated remainder \d+ s, over 30 s\)/;

function sideOf(repo: CatchUpRepo): CatchUpSide {
  return catchUpSide(repo, repo.main, { files: FILES, hostSlots: 8, policy: RUN_MISSING });
}

/** The named files as a named wait of `side`'s daemon reads them now. */
function named(side: CatchUpSide) {
  const { store, worktreeId, root } = side;
  const now = Date.now();
  const daemon = daemonLiveness(store.worktrees.get(worktreeId)?.daemon ?? null, now);
  return standingsOf(store, worktreeId, root, daemon, now)(NAMED);
}

function lastOf(side: CatchUpSide) {
  const { store, worktreeId } = side;
  const startedAt = store.worktrees.get(worktreeId)?.daemon?.startedAt ?? 0;
  return publishedYieldRow(store, worktreeId, startedAt).last;
}

/** The slow tier cut once for `F` and `G`, then started again and held in flight. */
async function restarted() {
  const repo = catchUpRepo(FILES);
  const side = sideOf(repo);
  await side.scheduler.start();
  await side.scheduler.idle();
  const base = side.runner.runs.length;
  const hold = holdRuns(side.runner, (path) => SLOW.includes(path));
  await side.edit("watch", "src/s.ts", "f.config.json");
  const first = await heldRun(side, SLOW[0] ?? "", base);
  await side.scheduler.promote(PROMOTED, 60_000);
  await expect.poll(() => first.cancelled, { timeout: CUT_WITHIN_MS }).toBe(true);
  const cutAt = side.runner.runs.length;
  const second = await heldRun(side, SLOW[0] ?? "", cutAt);
  return { repo, side, hold, second };
}

describe("a named wait names the last yield (row 011-209, issue-91 F2 and F3)", {
  timeout: 180_000,
}, () => {
  it("the restarted tier's line names the yield: when, to what, why, the files it cut and the run time lost", async () => {
    const { side, hold } = await restarted();
    const last = lastOf(side);
    expect(last).toMatchObject({
      to: "promoted",
      rule: "remainder",
      files: SLOW.map((path) => ({ project: "", path })),
    });
    expect(last?.runEndedAt).not.toBeNull();
    expect(last?.runEndedAt ?? 0).toBeGreaterThanOrEqual(last?.runStartedAt ?? Infinity);

    const files = named(side);
    // The standing words the lane as status does; the row keeps the runner's name (none here).
    expect(files[0]?.standing).toMatchObject({
      kind: "running",
      lastYield: { to: "promoted", lane: "vitest" },
    });
    const [, running] = classLines(files, "squeal");
    expect(running).toMatch(
      new RegExp(
        `^ {2}4 in the vitest tier of 4 test files running since \\S+${KEPT.source}: test/s1`,
      ),
    );
    // No restart note: this daemon keeps its yields, and a tier of the lane has ended.
    expect(running).not.toMatch(/no yield kept/);
    // `--json`: the entry carries the yield as data.
    const [first] = files;
    if (first === undefined) throw new Error("no named file");
    expect(fileEntry(first, "squeal").lastYield).toMatchObject({
      to: "promoted",
      rule: "remainder",
    });
    hold.stop();
    await side.scheduler.idle();
  });

  it("a promotion behind the restarted tier: the 'cut' reason names the yield it means (F3)", async () => {
    const { side, hold, second } = await restarted();
    await side.edit("watch", "src/f.ts");
    await side.scheduler.promote(PROMOTED, 60_000);
    await pause(SETTLE_MS);
    expect(second.cancelled).toBe(false);
    const queued = classLines(named(side), "squeal").find((line) => line.includes("f/f.test.ts"));
    expect(queued).toMatch(
      new RegExp(
        `; the tier does not yield: it holds a file a yield already cut at its key${KEPT.source}: f: f/f\\.test\\.ts`,
      ),
    );
    hold.stop();
    await side.scheduler.idle();
  });

  it("the yield goes once the restarted tier ends", async () => {
    const { side, hold } = await restarted();
    expect(lastOf(side)).not.toBeNull();
    hold.stop();
    await side.scheduler.idle();
    expect(lastOf(side)).toBeNull();
    expect(classLines(named(side), "squeal").join("\n")).not.toMatch(/a yield at/);
  });

  it("a restart keeps no yield, and the new daemon's first tier says so", async () => {
    const { repo, side, hold } = await restarted();
    expect(lastOf(side)).not.toBeNull();
    // A stopped daemon: its tier in flight is cancelled, its files queued for the next one.
    await side.scheduler.close({ cancel: true });
    hold.stop();
    const next = sideOf(repo);
    const again = holdRuns(next.runner, (path) => SLOW.includes(path));
    await next.scheduler.start();
    await heldRun(next, SLOW[0] ?? "", 0);
    expect(lastOf(next)).toBeNull();
    const [, running] = classLines(named(next), "squeal");
    expect(running).not.toMatch(/a yield at/);
    expect(running).toMatch(
      /^ {2}4 in the vitest tier of 4 test files running since \S+; no yield kept since the daemon started at \d\d:\d\d:\d\d: test\/s1/,
    );
    again.stop();
    await next.scheduler.idle();
  });
});
