import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { worktreePath } from "../../src/cli/named-selection.js";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import { requestGroup } from "../../src/core/daemon/run-group.js";
import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import type {
  AbsolutePath,
  CheckGroup,
  RelativePath,
  RevisionNumber,
} from "../../src/core/types/index.js";
import { shellWords } from "../../src/harness/shared/test-command.js";
import { type CatchUpFile, catchUpRepo, catchUpSide } from "../scheduler/catch-up-fixture.js";
import { groupPolicy, inTurn, runnerLane, tierLog } from "../scheduler/group-lanes-fixture.js";
import { NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Review 0.1.412 B1 (row 019-52, spec 019 D6 "Narrow run"): the narrow run
 * a named wait prints runs exactly the left files it names. A source path
 * selects the edit work, the namesake and the `tierSize` shortest other
 * importers; a named wait on it leaves every reader. So the command names
 * the left test files' own paths, and run as printed through the real
 * scheduler, it runs all of them.
 */

const SOURCE = "src/core.ts";
const READERS: readonly CatchUpFile[] = [
  { path: "test/core.test.ts", ms: 30, imports: [SOURCE] },
  { path: "test/x.test.ts", ms: 10, imports: [SOURCE] },
  { path: "test/z.test.ts", ms: 50, imports: [SOURCE] },
];
const PATHS = READERS.map((f) => f.path);
const BROWSER: CheckGroup = { name: "browser", runner: "vitest", tests: ["test/**"], at: "manual" };

/** The named wait on `SOURCE`, every reader queued for the manual group: its printed narrow run. */
async function printedRun(): Promise<string> {
  const { repo, store } = repoWith(PATHS);
  writeFileSync(
    join(repo.main, "squeal.config.json"),
    JSON.stringify({ checks: [BROWSER], runner: { tierSize: 1 } }),
  );
  for (const path of PATHS) {
    store.testFiles.put({
      testFile: ref(path),
      closure: {
        testFile: ref(path),
        paths: [path, SOURCE].sort() as never,
        complete: false,
        method: CLOSURE_METHOD,
      },
      updatedAt: NOW,
      updatedBy: repo.mainId,
    });
  }
  const synced = { state: "synced" as const, revision: 4 as RevisionNumber, incarnation: null };
  const wait = await waitForNamed(repo.main as AbsolutePath, [SOURCE], {
    timeoutMs: 3_000,
    pollMs: 20,
    settleMs: 0,
    now: () => NOW,
    sync: () => ({ current: () => synced, stop: () => {} }),
  });
  if (wait.outcome === "unavailable") throw new Error("unavailable");
  const last = namedText(wait, NOW).trimEnd().split("\n").at(-1) ?? "";
  expect(last).toContain(
    `3 browser test files wait for \`squeal run browser\`, which this wait does not hold for: ${PATHS.join(", ")}; `,
  );
  const run = /`(squeal run browser [^`]*--wait 60000)`/.exec(last)?.[1];
  if (run === undefined) throw new Error(`no narrow run in: ${last}`);
  return run;
}

describe("a named wait on a source names a narrow run of every reader it leaves (review 0.1.412 B1)", () => {
  it("run as printed, the command runs all three readers, past tierSize 1", {
    timeout: 60_000,
  }, async () => {
    const printed = await printedRun();
    const words = shellWords(printed);
    expect(words?.slice(0, 3)).toEqual(["squeal", "run", "browser"]);
    expect(words?.slice(-2)).toEqual(["--wait", "60000"]);
    const given = words?.slice(3, -2) ?? [];

    const repo = catchUpRepo(READERS);
    const slotDir = mkdtempSync(join(tmpdir(), "squeal-019-52-slot-"));
    onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
    const side = catchUpSide(repo, repo.main, {
      files: READERS,
      hostSlots: 8,
      tierSize: 1,
      lane: runnerLane,
      policy: groupPolicy({ checks: [BROWSER] }),
      scheduler: { slow: { slotDir, recheckMs: 50, cpus: () => 1, load: () => [0] } },
    });
    await inTurn(side);
    await side.scheduler.start();
    await side.scheduler.idle();
    // The CLI resolves each word against its directory, here the worktree's top level.
    const root = side.root as AbsolutePath;
    const rel = given.map((path) => worktreePath(root, root, path) as RelativePath);
    const request = await requestGroup(side.scheduler, "browser", undefined, rel);
    expect(request?.narrow?.selected.map((f) => f.path).sort()).toEqual(PATHS);
    for (const path of PATHS) {
      await expect.poll(() => side.current(path), { timeout: 20_000 }).toBe(true);
    }
    expect(tierLog(side.runner.runs)["group:browser:vitest"]?.flat().sort()).toEqual(PATHS);
  });
});
