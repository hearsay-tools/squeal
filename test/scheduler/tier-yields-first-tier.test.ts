import { describe, expect, it } from "vitest";
import { classLines } from "../../src/cli/named-file-lines.js";
import { daemonLiveness } from "../../src/core/delivery/liveness.js";
import { standingsOf } from "../../src/core/status/standing.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { heldRun, holdRuns, ref } from "./tier-yields-fixture.js";

/*
 * Row 011-209, rule C (`tasks/011-209/notes.md`; the coordinator's reply to
 * request 96b33632): a named wait's line of a several-file tier in a fast
 * lane says no yield is kept since the daemon started only while that tier
 * is the first one the daemon started in its lane. Once a tier of the lane
 * ended, any later yield is one the daemon keeps, so the note goes.
 */
const SLOW = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
const FILES: CatchUpFile[] = SLOW.map((path) => ({ path, ms: 20_000, imports: ["src/s.ts"] }));
const NOTE = /; no yield kept since the daemon started at \d\d:\d\d:\d\d: test\/s1/;

/** The four files' line in a named wait of `side`'s daemon now. */
function line(side: CatchUpSide): string | undefined {
  const { store, worktreeId, root } = side;
  const now = Date.now();
  const daemon = daemonLiveness(store.worktrees.get(worktreeId)?.daemon ?? null, now);
  const files = standingsOf(store, worktreeId, root, daemon, now)(SLOW.map((p) => ref(p)));
  return classLines(files, "squeal")[1];
}

describe("the restart note shows on a daemon's first tier in a lane only (row 011-209, rule C)", {
  timeout: 120_000,
}, () => {
  it("shows on the first tier, and is gone on the next once the first ended, with no yield", async () => {
    const repo = catchUpRepo(FILES);
    const side = catchUpSide(repo, repo.main, { files: FILES, hostSlots: 8, policy: RUN_MISSING });
    const first = holdRuns(side.runner, (path) => SLOW.includes(path));
    const started = side.scheduler.start();
    await heldRun(side, SLOW[0] ?? "", 0);
    expect(line(side)).toMatch(
      /^ {2}4 in the vitest tier of 4 test files running since \S+; no yield kept since/,
    );
    expect(line(side)).toMatch(NOTE);
    first.stop();
    await started;
    await side.scheduler.idle();

    const base = side.runner.runs.length;
    const next = holdRuns(side.runner, (path) => SLOW.includes(path));
    await side.edit("watch", "src/s.ts");
    await heldRun(side, SLOW[0] ?? "", base);
    expect(line(side)).toMatch(/^ {2}4 in the vitest tier of 4 test files running since \S+: /);
    expect(line(side)).not.toMatch(/no yield kept/);
    next.stop();
    await side.scheduler.idle();
  });
});
