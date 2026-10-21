import { describe, expect, it } from "vitest";
import { classLines, fileEntry } from "../../src/cli/named-file-lines.js";
import { daemonLiveness } from "../../src/core/delivery/liveness.js";
import { publishedYields } from "../../src/core/scheduler/yields.js";
import { nextStep } from "../../src/core/status/next-step.js";
import { standingsOf } from "../../src/core/status/standing.js";
import type { Standing } from "../../src/core/types/index.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { heldRun, holdRuns, ref } from "./tier-yields-fixture.js";

/*
 * Row 011-51, test 8 of `research/running-tier-yields.md` (spec 011 C15 as
 * amended 2026-10-21): a named wait's line for a promoted file queued behind
 * a running tier says the tier yields, or why it does not, and `--json`'s
 * entry carries the same reason. The daemon publishes what each tier in
 * flight does in one `meta` row; status reads it only from the live daemon.
 */
const SLOW = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
const F = "f/f.test.ts";

/** A tier of the four slow files held in flight, `ms` each, and `F` promoted behind it. */
async function promotedBehind(ms: number): Promise<CatchUpSide> {
  const files: CatchUpFile[] = [
    ...SLOW.map((path) => ({ path, ms, imports: ["src/s.ts"] })),
    { project: "f", path: F, ms: 1, imports: ["src/f.ts"] },
  ];
  const repo = catchUpRepo(files);
  // The run ignores the cancel, so a tier that yields stays in flight while the test reads it.
  const side = catchUpSide(repo, repo.main, { files, hostSlots: 8, cancels: false });
  await side.scheduler.start();
  await side.scheduler.idle();
  const base = side.runner.runs.length;
  holdRuns(side.runner, (path) => SLOW.includes(path));
  await side.edit("watch", "src/s.ts", "f.config.json");
  await heldRun(side, SLOW[0] ?? "", base);
  await side.scheduler.promote([ref(F, "f")], 60_000);
  return side;
}

/** `F` as a named wait reads it now. */
function named(side: CatchUpSide) {
  const { store, worktreeId, root } = side;
  const now = Date.now();
  const daemon = daemonLiveness(store.worktrees.get(worktreeId)?.daemon ?? null, now);
  const [file] = standingsOf(store, worktreeId, root, daemon, now)([ref(F, "f")]);
  if (file === undefined) throw new Error("no named file");
  return file;
}

describe("the wait says whether the tier yields (spec 011 C15 as amended 2026-10-21, row 011-51)", {
  timeout: 120_000,
}, () => {
  it("a tier that yields: '; the tier yields', in the line and in --json", async () => {
    const side = await promotedBehind(200_000);
    const file = named(side);
    expect(file.standing).toMatchObject({
      kind: "queued",
      promoted: true,
      yields: { kind: "yields" },
    });

    // The first line is the header, `Pending (1):`.
    const [, line] = classLines([file], "squeal");
    expect(line).toMatch(
      /queued, promoted, behind the vitest tier of 4 test files running since \S+; the tier yields: f: f\/f\.test\.ts$/,
    );
    const entry = fileEntry(file, "squeal");
    expect(entry.reason).toMatch(/; the tier yields$/);
    expect(entry.next).toBeUndefined();
  });

  it("a tier that does not yield names its remainder, in the line and in --json", async () => {
    const side = await promotedBehind(20_000);
    const file = named(side);
    expect(file.standing).toMatchObject({ yields: { kind: "remainder" } });

    const reason =
      /; the tier does not yield: its estimated remainder was (1\d|20) s, not over 30 s/;
    // The first line is the header, `Pending (1):`.
    const [, line] = classLines([file], "squeal");
    expect(line).toMatch(reason);
    const entry = fileEntry(file, "squeal");
    expect(entry.reason).toMatch(reason);
    expect(entry.next).toBe(
      "no command runs it sooner (a running tier that does not yield is waited for)",
    );
  });

  it("the row goes when no tier is in flight; a predecessor's row says nothing", async () => {
    const side = await promotedBehind(20_000);
    const { store, worktreeId } = side;
    const startedAt = store.worktrees.get(worktreeId)?.daemon?.startedAt ?? 0;
    expect([...publishedYields(store, worktreeId, startedAt).values()]).toHaveLength(1);
    expect(publishedYields(store, worktreeId, Date.now() + 60_000).size).toBe(0);
    side.runner.release();
    await side.scheduler.idle();
    expect(publishedYields(store, worktreeId, startedAt).size).toBe(0);
  });

  it("words every reason, and the unlisted revision's run that yields", () => {
    const queued = (yields: NonNullable<Extract<Standing, { kind: "queued" }>["yields"]>) =>
      nextStep({ kind: "queued", lane: "vitest", behind: 0, files: 4, promoted: true, yields })
        .reason;
    expect(queued({ kind: "cut" })).toMatch(
      /; the tier does not yield: it holds a file a yield already cut at its key$/,
    );
    expect(queued({ kind: "turn" })).toMatch(
      /; the tier does not yield: it is the backlog's turn$/,
    );
    expect(queued({ kind: "runner" })).toMatch(
      /; the tier does not yield: its runner runs each tier to its end$/,
    );
    const unlisted = nextStep({
      kind: "unlisted",
      revision: 5,
      callBoundMs: 666_000,
      yields: { kind: "yields" },
    });
    expect(unlisted.reason).toBe(
      "revision 5 not listed yet, because the runner part waits for the run in flight, each of its calls bounded at 666 s; the run yields",
    );
    // An older daemon publishes nothing: the wording stays as it was.
    expect(nextStep({ kind: "queued", lane: "vitest", behind: 0, promoted: true }).step).toEqual({
      kind: "none",
      text: "no command runs {it} sooner (a running tier is not interrupted)",
    });
  });
});
