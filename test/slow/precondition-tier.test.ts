import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { POLICY_FILE } from "../../src/core/daemon/policy.js";
import { readSlowActivity } from "../../src/core/slow/state.js";
import { slowTierText, testFileOf } from "../../src/core/state/index.js";
import { DEFAULT_POLICY, type Policy, type SlowPrecondition } from "../../src/core/types/index.js";
import {
  createRepo,
  type Harness,
  type HarnessOptions,
  openHarness,
  openRepoStore,
  SLOW,
} from "../scheduler/helpers.js";
import { waitFor } from "../watcher/helpers.js";

/*
 * Spec 004 D7 and D8 as amended 2026-10-17 (task 004-65, issues #3 and #16),
 * with the scheduler over real Vitest runs: an unmet precondition skips the
 * slow tier with one reason and runs nothing, a met one runs it as before,
 * and one that becomes met runs at the revision that makes it so. In the
 * `basic` fixture `test/strings.test.ts` and `test/upper.test.ts` are slow here.
 */

const STRINGS = "test/strings.test.ts";
const UPPER = "test/upper.test.ts";
const SLOW_FILES = [STRINGS, UPPER];
const NODE = process.execPath;
const MISSING = "dist/index.js matches no file (slow.precondition.exists)";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function open(
  precondition: SlowPrecondition,
  setup?: (h: Harness) => void,
  reloadPolicy?: HarnessOptions["reloadPolicy"],
) {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-004-65-slot-"));
  dirs.push(slotDir);
  const slow = { ...DEFAULT_POLICY.slow, include: SLOW_FILES, maxParallel: 1, precondition };
  // Headers read the policy on disk: the scheduler's is the same.
  writeFileSync(join(repo.main, POLICY_FILE), JSON.stringify({ slow }));
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    policy: { slow },
    slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
    ...(reloadPolicy === undefined ? {} : { reloadPolicy }),
  });
  setup?.(h);
  // The harness registers no worktree row; the slow-tier line finds the policy through it.
  const worktree = { root: h.root, commonDir: repo.commonDir, isMain: true, daemon: null };
  store.worktrees.upsert({ id: h.worktreeId, registeredAt: 1, ...worktree });
  await h.scheduler.start();
  await h.scheduler.idle();
  return h;
}

const slowRuns = (h: Harness) =>
  h.runner.runs
    .map((run) => run.files.map((f) => f.path))
    .filter((files) => files.some((f) => SLOW_FILES.includes(f)));
const pendingSlow = (h: Harness) =>
  h.store.testFileKeys
    .list(h.worktreeId)
    .filter((row) => row.pending !== null && SLOW_FILES.includes(row.testFile.path));
const line = (h: Harness) => slowTierText(h.header(), "squeal") ?? "";

describe("a slow tier's precondition (spec 004 D7, D8 as amended 2026-10-17)", SLOW, () => {
  it("skips the tier for a missing file with one reason, running and storing nothing", async () => {
    const h = await open({ exists: ["dist/index.js"] });
    expect(slowRuns(h)).toEqual([]);
    expect(h.runsOf("test/math.test.ts")).toHaveLength(1);
    expect(pendingSlow(h)).toEqual([]);
    expect(readSlowActivity(h.store, h.worktreeId)).toMatchObject({
      kind: "skipped",
      reason: MISSING,
    });
    const slow = h.header().slowTier;
    expect(slow).toMatchObject({ testFiles: 2, current: 0, pending: 0, notRun: 2 });
    expect(line(h)).toContain(`2 not run at revision ${h.header().revision}, skipped: ${MISSING}`);
    expect(line(h)).toContain("Squeal runs them once the precondition holds");
    // No result stored: a skip is no pass, no failure and no current file.
    const slowStates = h.store.knownStates
      .list(h.worktreeId)
      .filter((s) => SLOW_FILES.includes(testFileOf(s.check).path));
    expect(slowStates.filter((s) => s.validity === "current")).toEqual([]);
  });

  it("skips the tier for a failing command, naming the command and its exit code", async () => {
    const h = await open({ command: [NODE, "-e", "process.exit(1)"] });
    expect(slowRuns(h)).toEqual([]);
    const activity = readSlowActivity(h.store, h.worktreeId);
    expect(activity?.kind === "skipped" ? activity.reason : null).toMatch(
      / -e "process.exit\(1\)" exited 1 \(slow\.precondition\.command\)$/,
    );
    expect(line(h)).toContain("skipped: ");
  });

  it("runs the tier unchanged when the precondition holds", async () => {
    const check = `require("fs").accessSync("dist/index.js")`;
    const h = await open({ exists: ["dist/*.js"], command: [NODE, "-e", check] }, (h) =>
      h.write("dist/index.js", "export {};\n"),
    );
    expect(slowRuns(h).sort()).toEqual([[STRINGS], [UPPER]]);
    expect(readSlowActivity(h.store, h.worktreeId)).toBeNull();
    expect(line(h)).not.toContain("skipped");
  });

  it("runs the tier at the revision that writes a missing file, and not at one that does not", async () => {
    const h = await open({ exists: ["dist/index.js"] });
    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // edited\n");
    await h.batch("src/math.ts");
    await h.scheduler.idle();
    expect(slowRuns(h)).toEqual([]);
    expect(readSlowActivity(h.store, h.worktreeId)).toMatchObject({ kind: "skipped" });

    h.write("dist/index.js", "export {};\n");
    await h.batch("dist/index.js");
    await waitFor(() => slowRuns(h).length === 2, 60_000);
    await h.scheduler.idle();
    expect(h.header().slowTier).toMatchObject({ current: 2, notRun: 0 });
    expect(line(h)).not.toContain("skipped");
  });

  it("checks a command again at the next revision, whatever it touched", async () => {
    const check = `require("fs").accessSync("ready")`;
    const h = await open({ command: [NODE, "-e", check] });
    expect(slowRuns(h)).toEqual([]);
    h.write("ready", "");
    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b; // edited\n");
    await h.batch("src/math.ts");
    await waitFor(() => slowRuns(h).length === 2, 60_000);
  });

  it("skips a run --slow request's files again while the precondition is unmet", async () => {
    const h = await open({ exists: ["dist/index.js"] });
    expect(await h.scheduler.requestSlowSuite()).toMatchObject({ queued: 2 });
    await h.scheduler.idle();
    expect(slowRuns(h)).toEqual([]);
    expect(pendingSlow(h)).toEqual([]);
    expect(readSlowActivity(h.store, h.worktreeId)).toMatchObject({ reason: MISSING });
    // Met since, with no revision (a build output the watcher ignores): the next request runs it.
    h.write("dist/index.js", "export {};\n");
    expect(await h.scheduler.requestSlowSuite()).toMatchObject({ queued: 2 });
    await waitFor(() => slowRuns(h).length === 2, 60_000);
  });

  it("ends a run --all checkpoint abandoned, its slow lane skipped and its fast lane run", async () => {
    const h = await open({ exists: ["dist/index.js"] });
    const before = h.runsOf("test/math.test.ts").length;
    const checkpoint = await h.scheduler.requestFullSuite({ force: true });
    await h.scheduler.idle();
    expect(h.runsOf("test/math.test.ts").length).toBe(before + 1);
    expect(slowRuns(h)).toEqual([]);
    expect(h.store.checkpoints.get(checkpoint.id)?.end).toBe("abandoned");
    expect(readSlowActivity(h.store, h.worktreeId)).toMatchObject({ reason: MISSING });
  });

  it("checks again at the revision whose policy changes the precondition", async () => {
    let policy: Policy | null = null;
    const h = await open({ exists: ["dist/index.js"] }, undefined, () => policy);
    expect(slowRuns(h)).toEqual([]);
    // A path the old globs do not select: only the changed declaration makes the files eligible.
    const precondition = { exists: ["src/strings.ts"] };
    const slow = { ...DEFAULT_POLICY.slow, include: SLOW_FILES, maxParallel: 1, precondition };
    policy = { ...DEFAULT_POLICY, slow };
    h.write("squeal.config.json", JSON.stringify({ slow }));
    await h.batch("squeal.config.json");
    await waitFor(() => slowRuns(h).length === 2, 60_000);
  });
});
