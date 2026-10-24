import { appendFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classLines, fileEntry } from "../../../../../../src/cli/named-file-lines.js";
import { daemonLiveness } from "../../../../../../src/core/delivery/liveness.js";
import { publishedYields } from "../../../../../../src/core/scheduler/yields.js";
import { standingsOf } from "../../../../../../src/core/status/standing.js";
import { RUN_MISSING } from "../../../../../../test/helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "../../../../../../test/scheduler/catch-up-fixture.js";
import { heldRun, holdRuns, ref } from "../../../../../../test/scheduler/tier-yields-fixture.js";

// Throwaway probe for issue 91. Prints what a named wait shows around a yield.
const SLOW = [1, 2, 3, 4].map((i) => `test/s${i}.test.ts`);
const [F, G] = ["f/f.test.ts", "f/g.test.ts"];
const LOG = new URL("./observed.txt", import.meta.url);
const log = (text: string) => appendFileSync(LOG, `${text}\n`);
const NAMED = [...SLOW.map((p) => ref(p)), ref(F, "f"), ref(G, "f")];

function snapshot(side: CatchUpSide, label: string) {
  const { store, worktreeId, root } = side;
  const now = Date.now();
  const daemon = daemonLiveness(store.worktrees.get(worktreeId)?.daemon ?? null, now);
  const files = standingsOf(store, worktreeId, root, daemon, now)(NAMED);
  const startedAt = store.worktrees.get(worktreeId)?.daemon?.startedAt ?? 0;
  const out = {
    label,
    lines: classLines(files, "squeal"),
    entries: files.map((f) => fileEntry(f, "squeal")),
    pending: files.map((f) => ({ path: f.testFile.path, state: f.state, pending: f.pending })),
    yieldsRow: Object.fromEntries(publishedYields(store, worktreeId, startedAt)),
  };
  log(`=== ${label}\n${JSON.stringify(out, null, 2)}`);
  return out;
}

describe("issue 91: what a named wait shows of a yield", { timeout: 120_000 }, () => {
  it("cut, restart, and after", async () => {
    const files: CatchUpFile[] = [
      ...SLOW.map((path) => ({ path, ms: 200_000, imports: ["src/s.ts"] })),
      { project: "f", path: F, ms: 1, imports: ["src/f.ts"] },
      { project: "f", path: G, ms: 1, imports: ["src/f.ts"] },
    ];
    writeFileSync(LOG, "");
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 8, policy: RUN_MISSING });
    await side.scheduler.start();
    await side.scheduler.idle();
    const base = side.runner.runs.length;
    const hold = holdRuns(side.runner, (path) => SLOW.includes(path));
    await side.edit("watch", "src/s.ts", "f.config.json");
    const first = await heldRun(side, SLOW[0] ?? "", base);
    snapshot(side, "A: tier of 4 in flight, nothing promoted");

    await side.scheduler.promote([ref(F, "f"), ref(G, "f")], 60_000);
    snapshot(side, "B: right after the promotion of F and G");
    await expect.poll(() => first.cancelled, { timeout: 30_000 }).toBe(true);
    const cutAt = side.runner.runs.length;
    snapshot(side, "C: after the cut");

    // Wait for the slow files to start again.
    const second = await heldRun(side, SLOW[0] ?? "", cutAt).catch(() => null);
    const runs = side.runner.runs.slice(base).map((r) => ({
      files: r.files.map((f) => f.path),
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      cancelled: r.cancelled,
      completed: r.completed.map((f) => f.path),
    }));
    log(`=== runner runs since the edit\n${JSON.stringify(runs, null, 2)}`);
    snapshot(side, `D: restart of the slow tier ${second === null ? "not seen" : "in flight"}`);

    // A third promotion while the restarted tier holds files a yield cut at their key.
    if (second !== null) {
      await side.edit("watch", "src/f.ts");
      await side.scheduler.promote([ref(F, "f"), ref(G, "f")], 60_000);
      await new Promise((r) => setTimeout(r, 1_500));
      snapshot(side, "E: F and G re-keyed and promoted again behind the restarted tier");
      log(`=== restarted tier cancelled: ${second.cancelled}`);
    }
    hold.stop();
    await side.scheduler.idle();
  });
});
