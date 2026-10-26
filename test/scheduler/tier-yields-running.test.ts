import { describe, expect, it } from "vitest";
import { classLines, fileEntry } from "../../src/cli/named-file-lines.js";
import { daemonLiveness } from "../../src/core/delivery/liveness.js";
import { standingsOf } from "../../src/core/status/standing.js";
import type { TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { heldRun, holdRuns, ref } from "./tier-yields-fixture.js";

/*
 * Row 011-209, `research/issue-91.md` F1 (spec 011 C15): while a promoted
 * file waits behind a running tier, the running files' line reads the
 * tier's yield standing as the queued line does, so the two lines agree.
 * Before, the running line said "a running tier is not interrupted"
 * whatever the daemon published.
 */
const SLOW = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
const F = "f/f.test.ts";
const NAMED: TestFileRef[] = [...SLOW.map((path) => ref(path)), ref(F, "f")];

/** A tier of the four slow files held in flight, `ms` each, and `F` promoted behind it. */
async function promotedBehind(ms: number): Promise<CatchUpSide> {
  const files: CatchUpFile[] = [
    ...SLOW.map((path) => ({ path, ms, imports: ["src/s.ts"] })),
    { project: "f", path: F, ms: 1, imports: ["src/f.ts"] },
  ];
  const repo = catchUpRepo(files);
  // The run ignores the cancel, so a tier that yields stays in flight while the test reads it.
  const side = catchUpSide(repo, repo.main, {
    files,
    hostSlots: 8,
    cancels: false,
    policy: RUN_MISSING,
  });
  await side.scheduler.start();
  await side.scheduler.idle();
  const base = side.runner.runs.length;
  holdRuns(side.runner, (path) => SLOW.includes(path));
  await side.edit("watch", "src/s.ts", "f.config.json");
  await heldRun(side, SLOW[0] ?? "", base);
  await side.scheduler.promote([ref(F, "f")], 60_000);
  return side;
}

/** The named files as a named wait reads them now. */
function named(side: CatchUpSide) {
  const { store, worktreeId, root } = side;
  const now = Date.now();
  const daemon = daemonLiveness(store.worktrees.get(worktreeId)?.daemon ?? null, now);
  return standingsOf(store, worktreeId, root, daemon, now)(NAMED);
}

describe("the running line reads the tier's yield standing (row 011-209, issue-91 F1)", {
  timeout: 120_000,
}, () => {
  it("a tier that yields: both lines say so, and the running line no longer says it is not interrupted", async () => {
    const side = await promotedBehind(200_000);
    const files = named(side);
    expect(files[0]?.standing).toMatchObject({ kind: "running", yields: { kind: "yields" } });
    const [, running, queued] = classLines(files, "squeal");
    expect(running).toMatch(
      /^ {2}4 in the vitest tier of 4 test files running since \S+; the tier yields: test\/s1\.test\.ts, /,
    );
    expect(running).not.toMatch(/not interrupted/);
    expect(queued).toMatch(/; the tier yields: f: f\/f\.test\.ts$/);
    const [first] = files;
    if (first === undefined) throw new Error("no named file");
    const entry = fileEntry(first, "squeal");
    expect(entry.reason).toMatch(/; the tier yields$/);
    expect(entry.next).toBeUndefined();
  });

  it("a tier that does not yield: both lines name its remainder and that it is waited for", async () => {
    const side = await promotedBehind(20_000);
    const files = named(side);
    expect(files[0]?.standing).toMatchObject({ kind: "running", yields: { kind: "remainder" } });
    const [, running, queued] = classLines(files, "squeal");
    const notYielding =
      /; the tier does not yield: its estimated remainder was \d+ s, not over 30 s: .*; no command runs (?:it|them) sooner \(a running tier that does not yield is waited for\)$/;
    expect(running).toMatch(notYielding);
    expect(queued).toMatch(notYielding);
  });
});
