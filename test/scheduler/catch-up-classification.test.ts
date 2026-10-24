import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { createFsHasher, StatCache } from "../../src/core/hash/index.js";
import { reconcile, statCandidates } from "../../src/core/revision/index.js";
import type { InvalidatedPath } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpOptions,
  type CatchUpRun,
  catchUpRepo,
  catchUpSide,
  sources,
  testFiles,
} from "./catch-up-fixture.js";

/*
 * Review wave 5, B1 to B3 (spec 011 C4 step 4 as amended 2026-10-20, task
 * 011-22): "A revision that changes 10 or more keyed paths (test files,
 * closure paths or declared inputs) causes no edit's work", and only such a
 * revision. The count is one revision's, the test files it adds included,
 * and holds through the recovery from a runner failure. 24 test files,
 * file i importing source i % 12.
 */
const TWELVE = sources(12);

function options(files: readonly CatchUpFile[], tierSize = 4): CatchUpOptions {
  return { files, hostSlots: 4, tierSize, policy: RUN_MISSING };
}

async function started(files: CatchUpFile[], tierSize?: number) {
  const repo = catchUpRepo(files);
  const side = catchUpSide(repo, repo.main, options(files, tierSize));
  await side.scheduler.start();
  await side.scheduler.idle();
  return { repo, side };
}

/** Each run after `before`: its files' paths and whether the pool granted it. */
function runsAfter(runs: readonly CatchUpRun[], before: number) {
  return runs.slice(before).map((run) => ({
    paths: run.files.map((f) => f.path),
    granted: run.workers !== undefined,
  }));
}

/** `count` test files `test/addedNN.test.ts` importing nothing, not yet in the repository. */
const added = (count: number): CatchUpFile[] =>
  Array.from({ length: count }, (_, i) => ({
    path: `test/added${String(i).padStart(2, "0")}.test.ts`,
    ms: 100,
    imports: [],
  }));

describe("scheduler: catch-up counts one revision's keyed paths (review wave 5)", {
  timeout: 120_000,
}, () => {
  it("B1. runs 12 added test files as catch-up: the pool's grant", async () => {
    const files = testFiles(1, [], () => 100);
    const { side } = await started(files);
    const before = side.runner.runs.length;
    const more = added(12);
    // The runner lists them from the next listing on.
    files.push(...more);
    await side.edit("watch", ...more.map((f) => f.path));
    await side.scheduler.idle();
    const runs = runsAfter(side.runner.runs, before);
    expect(runs.flatMap((r) => r.paths).sort()).toEqual(more.map((f) => f.path));
    expect(runs.every((r) => r.granted)).toBe(true);
  });

  it("B1. runs 6 edited and 6 added test files as catch-up, the edited ones included", async () => {
    const files = testFiles(6, [], () => 100);
    const { side } = await started(files);
    const before = side.runner.runs.length;
    const more = added(6);
    files.push(...more);
    await side.edit("watch", ...files.map((f) => f.path));
    await side.scheduler.idle();
    const runs = runsAfter(side.runner.runs, before);
    expect(runs.flatMap((r) => r.paths)).toHaveLength(12);
    expect(runs.every((r) => r.granted)).toBe(true);
  });

  it("B1, control. runs 9 sources' files and 3 unrelated added paths as an edit's work", async () => {
    const files = testFiles(24, TWELVE, () => 100);
    const { side } = await started(files);
    const before = side.runner.runs.length;
    await side.edit("watch", ...TWELVE.slice(0, 9), "a.md", "b.md", "c.md");
    await side.scheduler.idle();
    const runs = runsAfter(side.runner.runs, before);
    expect(runs.flatMap((r) => r.paths)).toHaveLength(18);
    expect(runs.every((r) => !r.granted && r.paths.length <= 4)).toBe(true);
  });

  it.each([
    { name: "12 sources, catch-up", edited: TWELVE, granted: true },
    { name: "6 sources, an edit's work", edited: TWELVE.slice(0, 6), granted: false },
  ])("B2. recovers from a runner failure with $name", async ({ edited, granted }) => {
    const files = testFiles(24, TWELVE, () => 100);
    const { side } = await started(files);
    const environment = side.runner.environment;
    side.runner.environment = async () => {
      throw new Error("no environment");
    };
    await side.edit("watch", "config.json");
    await side.scheduler.idle();
    side.runner.environment = environment;
    const before = side.runner.runs.length;
    await side.edit("watch", ...edited);
    await side.scheduler.idle();
    const runs = runsAfter(side.runner.runs, before);
    // Every file was blocked: all 24 run, those the revision reached in its group.
    expect(runs.flatMap((r) => r.paths)).toHaveLength(24);
    const reached = new Set(
      files.filter((f) => edited.includes(f.imports[0] ?? "")).map((f) => f.path),
    );
    const first = runs[0];
    expect(first?.paths.every((path) => reached.has(path))).toBe(true);
    expect(first?.granted).toBe(granted);
  });

  /** Two revisions an earlier daemon stored and never refined, then a start. */
  async function unrefined(...revisions: (readonly string[])[]) {
    const files = testFiles(24, TWELVE, () => 100);
    const { repo, side } = await started(files);
    await side.scheduler.close();
    const cache = StatCache.load(side.store.fileHashes, side.worktreeId);
    const hasher = createFsHasher(side.root, "sha1");
    for (const paths of revisions) {
      side.touch(...paths);
      const batch = { trigger: "watch" as const, paths: await statCandidates([...paths], hasher) };
      const revision = await reconcile(batch, cache, hasher, {
        worktreeId: side.worktreeId,
        store: side.store,
        head: () => readHead(side.root),
      });
      expect(revision?.changes).toHaveLength(paths.length);
    }
    const next = catchUpSide(repo, repo.main, options(files));
    await next.scheduler.start();
    await next.scheduler.idle();
    const reached = (sourcesOf: readonly string[]) =>
      new Set(files.filter((f) => sourcesOf.includes(f.imports[0] ?? "")).map((f) => f.path));
    return { runs: runsAfter(next.runner.runs, 0), reached };
  }

  it("B3. starts on two unrefined revisions of 6 sources each as an edit's work, never their union", async () => {
    const { runs } = await unrefined(TWELVE.slice(0, 6), TWELVE.slice(6));
    expect(runs.flatMap((r) => r.paths)).toHaveLength(24);
    expect(runs.every((r) => !r.granted && r.paths.length <= 4)).toBe(true);
  });

  it("B3. starts on a small and a large unrefined revision: the small one's files first, as an edit's", async () => {
    const { runs, reached } = await unrefined(TWELVE.slice(0, 6), TWELVE);
    expect(runs.flatMap((r) => r.paths)).toHaveLength(24);
    const small = reached(TWELVE.slice(0, 6));
    for (const run of runs) {
      if (run.paths.some((path) => small.has(path))) {
        expect(run).toMatchObject({ granted: false });
        expect(run.paths.every((path) => small.has(path))).toBe(true);
      } else {
        expect(run).toMatchObject({ granted: true });
      }
    }
    expect(runs[0]?.paths.every((path) => small.has(path))).toBe(true);
  });

  it("B3. ends an install wait on two revisions of 6 sources each as an edit's work", async () => {
    const files = testFiles(24, TWELVE, () => 100);
    const repo = catchUpRepo(files);
    writeFileSync(join(repo.main, "package.json"), '{"devDependencies":{"vitest":"^4"}}\n');
    const side = catchUpSide(repo, repo.main, options(files));
    await side.scheduler.start();
    await side.edit("watch", ...TWELVE.slice(0, 6));
    await side.edit("watch", ...TWELVE.slice(6));
    expect(side.runner.runs).toHaveLength(0);
    mkdirSync(join(repo.main, "node_modules"));
    await side.edit("watch", "node_modules/.package-lock.json");
    await side.scheduler.idle();
    const runs = runsAfter(side.runner.runs, 0);
    expect(runs.flatMap((r) => r.paths)).toHaveLength(24);
    expect(runs.every((r) => !r.granted && r.paths.length <= 4)).toBe(true);
  });

  it("B1. keeps recent a file an earlier revision's runner part reached after the catch-up revision's content part", async () => {
    // f000 imports src/a.ts; the runner names the target a direct importer of src/a.ts too. An
    // edit's tier of 1 takes no catch-up file beside the first group's.
    const files = testFiles(1, ["src/a.ts"], () => 100);
    const target: CatchUpFile = { path: "test/target.test.ts", ms: 100, imports: ["src/x.ts"] };
    files.push(target);
    const { side } = await started(files, 1);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { invalidate, affected } = side.runner;
    Object.assign(side.runner, {
      invalidate: async (paths: readonly InvalidatedPath[]) => {
        if (paths.some((p) => p.path === "src/a.ts")) await held;
        return invalidate();
      },
      affected: async (paths: readonly string[]) => {
        const { direct, transitive } = await affected(paths);
        const named = paths.includes("src/a.ts") ? [{ project: "", path: target.path }] : [];
        return { direct: [...direct, ...named], transitive };
      },
    });
    const before = side.runner.runs.length;
    // Revision A, small; its runner part waits while revision B, the target and 10 added tests, lands.
    await side.edit("watch", "src/a.ts");
    const more = added(10);
    files.push(...more);
    await side.edit("watch", target.path, ...more.map((f) => f.path));
    release();
    await side.scheduler.idle();
    const runs = runsAfter(side.runner.runs, before);
    expect(runs.flatMap((r) => r.paths)).toHaveLength(12);
    const ran = (path: string) => runs.find((r) => r.paths.includes(path));
    // The two revisions' edits first, in edit tiers of 1, then the additions as catch-up.
    expect(runs.slice(0, 2).every((r) => !r.granted && r.paths.length === 1)).toBe(true);
    expect(
      runs
        .slice(0, 2)
        .flatMap((r) => r.paths)
        .sort(),
    ).toEqual(["test/f000.test.ts", target.path]);
    for (const f of more) expect(ran(f.path)).toMatchObject({ granted: true });
  });
});
