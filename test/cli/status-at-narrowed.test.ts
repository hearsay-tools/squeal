import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Rows 023-51 and 023-53 (dogfood round 6, V4 and V8) on a `$TMPDIR` git
 * fixture with stand-in daemons. After a wide `--run` queued 4 files at
 * the commit, a call narrowed to one file counts that file first, the
 * rest of the commit daemon's queue on its own line, and its summary line
 * says it covers 1 named file of the 4 the change selects. Round 6:
 * "joined 1338 … 90 have a result now; 1248 still running" for `status
 * --at HEAD~1 test/store --wait`, and "0 pass -> fail, 0 fail -> pass, 1
 * unchanged, 0 unknown" read as "no test file changed".
 */

const A1 = ref("test/a1.test.ts");
const A2 = ref("test/a2.test.ts");
const Z = ref("test/z.test.ts");
const ZZ = ref("test/zz.test.ts");
const ALL = [A1, A2, Z, ZZ];

/** Commit A with four tests, and HEAD changing `src/a.ts`, which they read. */
function four() {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 2;\n",
    ...Object.fromEntries(ALL.map((file) => [file.path, testOf("a", 2)])),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2; // b\n" });
  return { f, a };
}

/** Marks `files` queued in the commit daemon of `tree`, at the stand-in's keys. */
function queued(f: Fixture, tree: string, files: readonly TestFileRef[]) {
  withStore(f, (store) =>
    store.testFileKeys.upsertMany(
      files.map((testFile) => ({
        worktreeId: worktreeIdFor(tree as AbsolutePath),
        testFile,
        key: `commit-${testFile.path}`,
        revision: 2,
        pending: "queued" as const,
      })),
    ),
  );
}

describe("a narrowed call behind a wide queue (rows 023-51, 023-53)", SLOW, () => {
  it("counts its named file first, the rest of the queue apart, and says what its summary covers", async () => {
    const { f, a } = four();
    const tree = standInTree(f);
    const daemons = standIn(tree, () => undefined, {
      select: (ask) =>
        ask.named.length === 0 ? ALL : ALL.filter((r) => ask.named.includes(r.path)),
      rows: (at, files) => queued(f, at, files),
      selects: 4,
    });
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: daemons.ports,
    };
    const at = a.slice(0, 9);
    await run(f, { commit: a, run: { allMissing: false }, waitMs: 2000 }, options);

    // `--wait` narrowed to one file joins that file, not the wide call's four.
    const join = await run(f, { commit: a, paths: [A1.path], waitMs: 2000 }, options);
    const lines = join.out.split("\n");
    const named = lines.findIndex((line) =>
      line.startsWith(`${A1.path}: 1 of 1 queued at ${at}, `),
    );
    expect(named, join.out).toBeGreaterThan(-1);
    expect(lines.findIndex((line) => line.startsWith("--wait: joined"))).toBeGreaterThan(named);
    expect(join.out).toContain(`--wait: joined 1 test files with no result at ${at}`);
    expect(join.out).toContain(
      `The rest of the queue, outside these paths: 3 more test files queued or running at ${at} (its worktree), `,
    );
    expect(join.out).toContain(
      `, of 1 named test file; the change selects 4 test files at ${at} (\`squeal status --at ${a}\`, without paths, compares them)`,
    );
    expect(join.out).toContain(`0 running and 1 queued at ${at} (its worktree)`);

    // A narrowed `--run` the same; JSON names the scope.
    const runJson = await run(
      f,
      { commit: a, paths: [A2.path], run: { allMissing: false }, waitMs: 2000, json: true },
      options,
    );
    const report = JSON.parse(runJson.out);
    expect(report.scope).toEqual({
      paths: [A2.path],
      files: 1,
      selects: 4,
      command: `squeal status --at ${a}`,
    });
    expect(report.run).toMatchObject({ paths: [A2.path], commit: { files: 1, rest: 3 } });

    // A wide call names no scope.
    const wide = await run(f, { commit: a, waitMs: 1000, json: true }, options);
    expect(JSON.parse(wide.out).scope).toBeNull();
  });
});
