import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath, EpochMs, RevisionNumber } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { check, clean, run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-60 (spec 023 D7.3, round 7 W3): `status --at <c> <file> --run`
 * whose named file still runs in the commit daemon's wider batch says so,
 * with that batch's time left, and counts at least that time; when the
 * file runs alone it keeps its own time. Round 7 told "about 3 s for 1
 * test file" while the file's result came 250 to 420 s later.
 */

const twelve = Array.from({ length: 12 }, (_, i) => ref(`test/b${i}.test.ts`));
const [NAMED] = twelve as [TestFileRef];

/** An environment whose pool is 8 host slots and no other daemon's mark. */
function ownPool(dir: string): NodeJS.ProcessEnv {
  const config = join(dir, "config");
  mkdirSync(join(config, "squeal"), { recursive: true });
  writeFileSync(join(config, "squeal", "config.json"), '{"capacity":{"hostSlots":8}}');
  return { ...process.env, XDG_CONFIG_HOME: config, XDG_RUNTIME_DIR: join(dir, "run") };
}

/**
 * The commit daemon of `tree`, live, has the named file running in a run
 * that started 60 s ago and holds `inRun`; each of the twelve files took 10 s,
 * or only the named one 3 s with `onlyNamed` (review 0.1.607 B1).
 */
async function call(inRun: readonly TestFileRef[], onlyNamed = false) {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 2;\n",
    ...Object.fromEntries(twelve.map((file) => [file.path, testOf("a", 2)])),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2; // b\n" });
  withStore(f, (store) =>
    store.results.putMany(
      (onlyNamed ? [NAMED] : twelve).map((file) => ({
        ...result(check(file.path), "elsewhere"),
        durationMs: onlyNamed ? 3_000 : 10_000,
      })),
    ),
  );
  const tree = standInTree(f);
  const id = worktreeIdFor(tree);
  const now = Date.now();
  let started = false;
  const rows = (_: AbsolutePath, files: readonly TestFileRef[]) =>
    withStore(f, (store) => {
      store.worktrees.upsert({
        id,
        root: tree,
        commonDir: realpathSync(join(f.root, ".git")) as AbsolutePath,
        isMain: false,
        registeredAt: now - 120_000,
        daemon: {
          socketPath: "/tmp/squeal-023-60-call.sock",
          startedAt: (now - 120_000) as EpochMs,
          heartbeatAt: now as EpochMs,
          heartbeatIntervalMs: 5_000,
          squealVersion: "0.0.0-test",
          token: "live",
        },
      });
      store.testFileKeys.upsertMany(
        files.map((testFile) => ({
          worktreeId: id,
          testFile,
          key: `commit-${testFile.path}`,
          revision: 2,
          pending: "running" as const,
        })),
      );
      if (started) return;
      started = true;
      store.runs.start({
        id: "batch",
        worktreeId: id,
        revision: 2 as RevisionNumber,
        testFiles: inRun,
        checkpointId: null,
        logDir: join(f.dir, "runs", "batch") as AbsolutePath,
        startedAt: (now - 60_000) as EpochMs,
      });
    });
  const daemons = standIn(tree, () => undefined, { select: () => [NAMED], rows });
  const options = {
    cacheRoot: f.cacheRoot,
    install: linkInstall().install,
    daemons: daemons.ports,
  };
  const args = { commit: a, paths: [NAMED.path], run: { allMissing: false }, waitMs: 1000 };
  const env = ownPool(f.dir);
  const json = await run(f, { ...args, json: true }, options, undefined, env);
  const estimate = JSON.parse(json.out).run.estimate.commit;
  const text = await run(f, args, options, undefined, env);
  clean(f);
  return { estimate, text: text.out, at: a.slice(0, 9) };
}

describe("status --at --run: the named file's time inside a wider batch (row 023-60)", SLOW, () => {
  it("names the batch and counts its time left", async () => {
    const { estimate } = await call(twelve);
    expect(estimate.batch).toMatchObject({ named: [NAMED], files: 12 });
    // 12 × 10 s over the run's width (at most the side's share of 8), less 60 s run, times load.
    expect(estimate.batch.ran).toBeGreaterThanOrEqual(60);
    expect(estimate.seconds).toBeGreaterThanOrEqual(estimate.batch.seconds);
    expect(estimate.seconds).toBeGreaterThan(10);
  });

  it("keeps the file's own time when it runs alone", async () => {
    const { estimate } = await call([NAMED]);
    expect(estimate.batch).toBeUndefined();
    expect(estimate.files).toBe(1);
  });

  it("keeps the time unknown when 1 of the batch's 12 files has a stored duration (review 0.1.607 B1)", async () => {
    const { estimate, text } = await call(twelve, true);
    // Own file: 3 s, known. Its batch: 1 of 12 stored, no rate measured: unknown, never 0.
    expect(estimate.batch).toMatchObject({ files: 12, known: 1, seconds: null });
    expect(estimate.seconds).toBeNull();
    expect(text).toContain(
      "1 test file, time unknown: its result waits for the batch that holds it",
    );
    expect(text).toContain("too few runs stored (1 of its 12 files has a stored duration)");
    expect(text).not.toContain("any time now");
  });
});
