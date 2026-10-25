import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CodePass,
  createCodePass,
  mainStoreSource,
  type PassReport,
} from "../../../src/core/code/pass/index.js";
import { listingMetaKey, parseListing } from "../../../src/core/types/index.js";
import {
  createRepo,
  type FailingCall,
  type Harness,
  openHarness,
  openRepoStore,
  SLOW,
} from "../../scheduler/helpers.js";
import { open } from "../helpers.js";
import { fakeCounter, policyOn } from "./helpers.js";

/*
 * Review 0.1.315 B2 (repair R11): a refined revision proves no listing. The
 * runner's `testFiles` rejects, the runner part still commits the revision
 * as refined, and the pass counted a test file it brought as source. The
 * pass reads the scheduler's record of a listing that did not fail
 * (`listingMetaKey`), nudged by `onListed` as in the daemon, so a held file
 * waits until the listing recovers, with or without a new revision.
 *
 * Fixture `barrel`. The fake counter reads a line `name cc body` as one
 * function, and no other line of the fixture's files.
 */

const TEST = "test/new.test.ts";
const TEST_TEXT =
  'import { it } from "vitest";\n\nconst s = `\nseeds 25 s2\n`;\n\nit("is new", () => void s);\n';
const SOURCE = "src/extra.ts";
const SOURCE_TEXT = "export const extra = `\nextra 25 e1\n`;\n";

/**
 * The barrel fixture under a real scheduler, the code pass nudged after each
 * batch and each listing; `files` written before it starts, `failing` from it.
 */
async function start(over: { files?: Record<string, string>; failing?: FailingCall[] } = {}) {
  const repo = createRepo("barrel");
  for (const [path, text] of Object.entries(over.files ?? {})) {
    writeFileSync(join(repo.main, path), text);
  }
  const store = openRepoStore(repo.commonDir);
  const errors: Error[] = [];
  const reports: string[] = [];
  let h: Harness | null = null;
  let code: CodePass | null = null;
  h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 1,
    allowErrors: true,
    ...(over.failing === undefined ? {} : { failing: over.failing }),
    onListed: () => code?.nudge(),
  });
  const harness = h;
  code = createCodePass({
    worktreeId: harness.worktreeId,
    root: harness.root,
    commonDir: repo.commonDir,
    format: "sha1",
    source: mainStoreSource(store, harness.worktreeId, () => harness.scheduler.extraFiles()),
    policy: () => policyOn(),
    counter: () => Promise.resolve(fakeCounter()),
    log: () => {},
    onError: (error) => errors.push(error),
    onPass: (report: PassReport) => reports.push(`${report.mode} ${report.transitions}`),
  });
  const pass = code;
  const codeStore = open(repo.commonDir);
  const settle = async () => {
    await harness.scheduler.idle();
    pass.nudge();
    await pass.idle();
  };
  await harness.scheduler.start();
  await settle();
  /** Each counted path, and each complexity state as `path:name outcome`. */
  const counted = () => ({
    files: codeStore.files.list(harness.worktreeId).map((f) => f.path),
    states: codeStore.states
      .list(harness.worktreeId, { measure: "complexity" })
      .map((s) => `${s.check.path}:${s.check.qualifiedName} ${s.outcome}`),
  });
  const listing = () => parseListing(store.meta.get(listingMetaKey(harness.worktreeId)));
  return { h: harness, code: pass, settle, counted, listing, errors, reports };
}

/** The same bytes again: a touched file, whose runner-only refinement lists again (001-159). */
async function touch(run: Awaited<ReturnType<typeof start>>) {
  run.h.write("src/strings.ts", readFileSync(join(run.h.root, "src/strings.ts"), "utf8"));
  await run.h.batch("src/strings.ts");
  await run.h.scheduler.idle();
  await run.code.idle();
}

/** Revision 2 brings a test file and a source while `testFiles` rejects. */
async function failedListing(run: Awaited<ReturnType<typeof start>>) {
  const { h, settle, counted, listing } = run;
  const before = listing();
  h.runner.failing.add("testFiles");
  h.write(TEST, TEST_TEXT);
  h.write(SOURCE, SOURCE_TEXT);
  await h.batch(TEST, SOURCE);
  await settle();
  const { revision } = h.header();
  expect(h.header()).toMatchObject({ runnerPartPending: false, refinedRevision: revision });
  expect(listing()).toEqual(before);
  // Neither is counted: the test file is never, and the source waits for the listing.
  expect(counted()).toEqual({
    files: ["src/index.ts", "src/math.ts", "src/strings.ts", "vitest.config.ts"],
    states: [],
  });
  h.runner.failing.delete("testFiles");
}

const RECOVERED = {
  files: ["src/extra.ts", "src/index.ts", "src/math.ts", "src/strings.ts", "vitest.config.ts"],
  states: ["src/extra.ts:extra fail"],
};

describe("a held file after a listing that failed (D1; review 0.1.315 B2)", SLOW, () => {
  it("counts no test file, and counts the held source once a source edit's listing recovers", async () => {
    const run = await start();
    await failedListing(run);
    run.h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase() + '';\n");
    await run.h.batch("src/strings.ts");
    await run.settle();
    expect(run.listing()?.revision).toBe(run.h.header().revision);
    expect(run.h.keyOf(TEST)).not.toBeNull();
    expect(run.counted()).toEqual(RECOVERED);
    expect(run.errors).toEqual([]);
  });

  it("counts the held source once a listing recovers with no new revision", async () => {
    const run = await start();
    await failedListing(run);
    const { revision } = run.h.header();
    const failed = run.listing();
    await touch(run);
    expect(run.h.header().revision).toBe(revision);
    expect(run.listing()).toEqual({ revision, count: (failed?.count ?? 0) + 1 });
    expect(run.h.keyOf(TEST)).not.toBeNull();
    expect(run.counted()).toEqual(RECOVERED);
    expect(run.errors).toEqual([]);
  });

  it("counts no test file whose refinement threw, also after a later source edit", async () => {
    const run = await start();
    const closure = run.h.runner.closure;
    // An absolute path in a closure cannot be keyed: the apply phase throws on it.
    run.h.runner.closure = async (testFile) => {
      const result = await closure(testFile);
      return testFile.path === TEST
        ? { ...result, paths: [...result.paths, "/outside/the/worktree.ts"] }
        : result;
    };
    run.h.write(TEST, TEST_TEXT);
    run.h.write(SOURCE, SOURCE_TEXT);
    await run.h.batch(TEST, SOURCE);
    await run.settle();
    // No listing is recorded, so both wait.
    expect(run.counted().files).not.toContain(TEST);
    expect(run.counted().files).not.toContain(SOURCE);
    // The runner part after it lists again (request e86a66d4), and records the listing once it applies.
    run.h.runner.closure = closure;
    run.h.write("src/strings.ts", "export const upper = (s: string) => s.toUpperCase() + '';\n");
    await run.h.batch("src/strings.ts");
    await run.settle();
    expect(run.counted().files).not.toContain(TEST);
    expect(run.counted().states).toEqual(RECOVERED.states);
  });

  it("waits with the first count while the start's listing fails, and counts with no transition once it lists", async () => {
    const run = await start({ files: { [SOURCE]: SOURCE_TEXT }, failing: ["testFiles"] });
    expect(run.listing()).toBeNull();
    expect(run.counted()).toEqual({ files: [], states: [] });
    run.h.runner.failing.delete("testFiles");
    await touch(run);
    expect(run.listing()).not.toBeNull();
    expect(run.reports).toEqual(["first 0"]);
    expect(run.counted()).toEqual(RECOVERED);
    expect(run.errors).toEqual([]);
  });
});
