import { randomUUID } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatCheck } from "../../src/core/state/index.js";
import { formatWhy, readWhy } from "../../src/core/status/index.js";
import type { AbsolutePath, CheckId, WhyReport } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import {
  addWorktree,
  createRepo,
  type Harness,
  openHarness,
  openRepoStore,
  SLOW,
} from "./helpers.js";

/*
 * Row 011-108 (gh-74): the run behind an UNKNOWN is recorded beside the
 * known state, never as a keyed result, and `why` names it, its worktree,
 * revision and log, also when every stored result is a pass. Worktree B
 * inherits A's pass, then its own run of the file loses its worker; B's
 * daemon restarts; A stores newer passes.
 */

const EXITS = "test/exits.test.ts";
const exits: CheckId = { kind: "test", project: "", testPath: EXITS, fullName: "exits" };
const DAY_MS = 24 * 60 * 60 * 1000;

const markers: string[] = [];
afterEach(() => {
  for (const marker of markers.splice(0)) rmSync(marker, { force: true });
});

/** `exits` kills its worker while a marker outside the worktree exists, which no key covers. */
function exitsSource(marker: string, note = ""): string {
  return [
    'import { existsSync } from "node:fs";',
    'import { expect, it } from "vitest";',
    "",
    `it("exits", () => {${note}`,
    `  if (existsSync(${JSON.stringify(marker)})) process.kill(process.pid, "SIGKILL");`,
    "  expect(1).toBe(1);",
    "});",
    "",
  ].join("\n");
}

const whyOf = (h: Harness) => readWhy(h.root as AbsolutePath, formatCheck(exits)) as WhyReport;

describe("the run behind an UNKNOWN (011-108)", SLOW, () => {
  it("is named by why across worktrees, a daemon restart and newer passes, and prune keeps it", async () => {
    const repo = createRepo();
    const marker = join(tmpdir(), `squeal-011-108-${randomUUID()}`);
    markers.push(marker);
    writeFileSync(join(repo.main, EXITS), exitsSource(marker));
    git(repo.main, ["add", EXITS]);
    git(repo.main, ["commit", "-qm", "exits"]);
    const other = addWorktree(repo.main, repo.dir, "b");
    const store = openRepoStore(repo.commonDir);

    const a = await openHarness(repo.main, store, repo.commonDir, { rerunCap: 0 });
    await a.scheduler.start();
    await a.scheduler.idle();
    expect(a.sink.stateOf(exits)).toMatchObject({ outcome: "pass", validity: "current" });

    const b = await openHarness(other, store, repo.commonDir, { rerunCap: 0 });
    await b.scheduler.start();
    await b.scheduler.idle();
    expect(b.runsOf(EXITS)).toHaveLength(0);
    expect(b.sink.stateOf(exits)?.origin).toMatchObject({ kind: "inherited" });

    // B's own run of the file, at a key B's edit gave it, loses its worker.
    writeFileSync(marker, "");
    b.write(EXITS, exitsSource(marker, " // b"));
    await b.batch(EXITS);
    await b.scheduler.idle();
    const [crashed] = b.runsOf(EXITS);
    expect(crashed?.report.end).toBe("crashed");
    const crashRun = crashed?.options.runId as string;
    expect(b.sink.stateOf(exits)).toMatchObject({ outcome: "unknown", origin: { kind: "own" } });
    expect(store.results.byKey(b.keyOf(EXITS) ?? "", 0)).toEqual([]);

    const why = whyOf(b);
    const logDir = store.runs.get(crashRun)?.logDir as string;
    expect(why.unknownRun).toMatchObject({
      runId: crashRun,
      worktreeId: b.worktreeId,
      revision: store.runs.get(crashRun)?.revision,
      error: expect.stringContaining("Worker forks emitted error"),
      log: { state: "present", path: join(logDir, "vitest.log") },
    });
    expect(formatWhy(why)).toContain(`Run log: ${join(logDir, "vitest.log")}`);
    expect(formatWhy(why)).not.toContain("no stored result, or several, fit the known state");
    // A's own state is a pass: no run of B's is named there.
    expect(whyOf(a).unknownRun).toBeUndefined();

    // Across a restart: with no daemon the record is in the store; the next daemon's crash is named.
    await b.scheduler.close();
    expect(whyOf(b).unknownRun?.runId).toBe(crashRun);
    const b2 = await openHarness(other, store, repo.commonDir, { rerunCap: 0 });
    await b2.scheduler.start();
    await b2.scheduler.idle();
    const last = (b2.runsOf(EXITS).at(-1) ?? crashed)?.options.runId as string;
    expect(store.runs.get(last)?.end).toBe("crashed");
    expect(b2.sink.stateOf(exits)?.outcome).toBe("unknown");
    expect(whyOf(b2).unknownRun).toMatchObject({ runId: last, log: { state: "present" } });

    // Newer results, every one a pass: A runs the same edit with the marker gone.
    rmSync(marker);
    a.write(EXITS, exitsSource(marker, " // a"));
    await a.batch(EXITS);
    await a.scheduler.idle();
    const after = whyOf(b2);
    expect(after.results.length).toBeGreaterThanOrEqual(2);
    expect(after.results.every((r) => r.result.outcome === "pass")).toBe(true);
    const lastAt = store.runs.get(last)?.startedAt as number;
    expect(after.results[0]?.result.provenance.recordedAt).toBeGreaterThan(lastAt);
    expect(after.knownState?.outcome).toBe("unknown");
    expect(after.unknownRun?.runId).toBe(last);

    // Prune keeps the run and its log while the UNKNOWN stands, past the cutoff too.
    store.prune({ now: Date.now() + 8 * DAY_MS, retentionDays: 7, maxSizeMb: null });
    expect(store.runs.get(last)).not.toBeNull();
    expect(existsSync(store.runs.get(last)?.logDir as string)).toBe(true);
    expect(whyOf(b2).unknownRun?.log?.state).toBe("present");
  });
});
