import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { type AtDaemons, realDaemons } from "../../src/cli/status-at-daemons.js";
import { installCommitWorktree } from "../../src/core/checkout/commit-setup.js";
import { storedReason } from "../../src/core/daemon/at-asks.js";
import { COMMIT_WORKTREES } from "../../src/core/daemon/commit-mode.js";
import { type RunningDaemon, startDaemon } from "../../src/core/daemon/daemon.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { CheckId } from "../../src/core/types/check.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { ResultRecord } from "../../src/core/types/store-records.js";
import { type Fixture, fixture, git, linkInstall, ref, write } from "../commit/at-keys-fixture.js";
import { childEnv, SLOW } from "../daemon/helpers.js";
import { run, testOf, withStore } from "./status-at-kit.js";

/*
 * Rows 023-70 and 023-76 (spec 023 D4.9 in the commit daemon; review
 * 0.1.611-rereview N1): a result the caller's worktree stored is read as
 * the commit side's only at a key the commit shares, and a folder read is
 * in that key by the names the run listed. `lists.test.ts` lists
 * `test/fixtures/` and expects two names; the commit tracks one.
 *
 * - With an ignored `extra.log` there, the caller's pass is stored at a key
 *   of two names, which the pristine commit does not share: the commit
 *   runs the file itself and fails. Before row 023-70 the call read the
 *   caller's pass as the commit's, "unchanged"; before row 023-76 it read
 *   "not comparable", since no record held the listing.
 * - With the commit's names on disk, the caller's result is stored at the
 *   commit's key, and still reads "not comparable" there (row 023-70's
 *   rule, kept by the 0.1.612 review repair): a key is computed before the
 *   run, so it does not certify what the run listed (review 0.1.612 B1).
 *   The commit does not run the file. Certifying read-time listings is left
 *   for a later row. The caller's result is a pass: a stored failure from
 *   another worktree is rechecked when the commit daemon starts (review
 *   0.1.612 B2).
 *
 * `plain.test.ts` reads no folder: its key and result are shared alike.
 */

const LISTS = ref("test/lists.test.ts");
const PLAIN = ref("test/plain.test.ts");
const RUN = { allMissing: false };
const LISTS_CHECK: CheckId = { kind: "test", project: "", testPath: LISTS.path, fullName: "lists" };

/** A test that lists `test/fixtures/` and expects `names` names. */
const listsOf = (names: number) =>
  [
    'import { readdirSync } from "node:fs";',
    'import { expect, it } from "vitest";',
    'import { value } from "../src/plain";',
    `it("lists", () => expect(readdirSync(new URL("./fixtures", import.meta.url)).length).toBe(${names} * value));`,
    "",
  ].join("\n");

/** Both real daemons in this process: the commit daemon with the fixture's install, and the worktree's. */
function bothDaemons(): AtDaemons {
  const runtime = realpathSync(mkdtempSync("/tmp/sq-at-"));
  const running: RunningDaemon[] = [];
  onTestFinished(async () => {
    for (const daemon of running) await daemon.stop("stop-requested");
    rmSync(runtime, { recursive: true, force: true });
  }, 60_000);
  const install = (tree: AbsolutePath) =>
    installCommitWorktree(tree, { install: linkInstall().install });
  return realDaemons({
    start: async (tree) => {
      const daemon = await startDaemon({
        root: tree,
        env: childEnv(runtime),
        commitWorktrees: { ...COMMIT_WORKTREES, install },
      });
      if ("reason" in daemon) return daemon.message;
      running.push(daemon);
      let exited = false;
      void daemon.exited.then(() => {
        exited = true;
      });
      return { lives: async () => !exited };
    },
    startWorktree: async (root) => {
      const daemon = await startDaemon({ root, env: childEnv(runtime) });
      if ("reason" in daemon) return daemon.message;
      running.push(daemon);
      return null;
    },
  });
}

type Side = { state: string; reason?: string; origin?: { kind: string } };
type Row = { path: string; at: Side; now: Side };
const rowOf = (out: string, path: string) =>
  (JSON.parse(out).files as Row[]).find((row) => row.path === path);

/** The runs of `lists.test.ts` that another worktree than the caller's stored, by run id. */
function foreignRuns(f: Fixture): string[] {
  const caller = worktreeIdFor(f.root);
  let records: readonly ResultRecord[] = [];
  withStore(f, (store) => {
    records = store.results.listForCheck(LISTS_CHECK, 20);
  });
  return records.filter((r) => r.provenance.worktreeId !== caller).map((r) => r.provenance.runId);
}

/** The fixture at `z`, then `a`, with both test files; `lists.test.ts` expects `names` names. */
function atA(names = 2) {
  const f = fixture({
    "squeal.config.json": "{}\n",
    ".gitignore": "node_modules/\n*.log\n",
    "src/plain.ts": "export const value = 1;\n",
    "test/fixtures/a.json": "{}\n",
    [LISTS.path]: listsOf(names),
    [PLAIN.path]: testOf("plain", 1),
  });
  const z = git(f.root, "rev-parse", "HEAD").trim();
  const a = f.commit({ "src/plain.ts": "export const value = 1; // a\n" });
  return { f, z, a, paths: [LISTS.path, PLAIN.path] };
}

describe("the caller's stored folder result at the commit (rows 023-70, 023-76)", SLOW, () => {
  it("is not the commit's when its run listed an ignored name: the commit runs and fails", {
    timeout: 400_000,
  }, async () => {
    const { f, z, a, paths } = atA();
    const options = { cacheRoot: f.cacheRoot, daemons: bothDaemons() };

    // The caller at `a`, with an ignored name in the listed folder: its run passes.
    write(f.root, { "test/fixtures/extra.log": "x" });
    const seeded = await run(
      f,
      { commit: z, paths, run: RUN, json: true, waitMs: 120_000 },
      options,
    );
    expect(rowOf(seeded.out, LISTS.path)?.now, seeded.err).toMatchObject({ state: "pass" });
    expect(rowOf(seeded.out, PLAIN.path)?.now, seeded.err).toMatchObject({ state: "pass" });

    // The caller deletes the name and moves on.
    rmSync(join(f.root, "test/fixtures/extra.log"));
    f.commit({ "src/plain.ts": "export const value = 1; // b\n" });
    const asked = await run(
      f,
      { commit: a, paths, run: RUN, json: true, waitMs: 120_000 },
      options,
    );

    // The pristine commit lists one name and fails; the caller's pass is not the commit's.
    expect(rowOf(asked.out, LISTS.path)?.at, asked.err).toMatchObject({
      state: "fail",
      origin: { kind: "commit" },
    });
    // A stored result with no folder read is the commit's: read, not run there.
    const plain = rowOf(asked.out, PLAIN.path)?.at;
    expect(plain, asked.err).toMatchObject({ state: "pass" });
    expect(plain?.origin?.kind).not.toBe("commit");
  });

  it("is not the commit's when another worktree wrote it, even over the commit's names (review 0.1.612 B1)", {
    timeout: 400_000,
  }, async () => {
    const { f, z, a, paths } = atA(1);
    const options = { cacheRoot: f.cacheRoot, daemons: bothDaemons() };
    // The caller at `a` lists the one name the commit tracks: its run passes, as the commit's would.
    const seeded = await run(
      f,
      { commit: z, paths, run: RUN, json: true, waitMs: 120_000 },
      options,
    );
    expect(rowOf(seeded.out, LISTS.path)?.now, seeded.err).toMatchObject({ state: "pass" });
    // The commit `z`'s own run of the file, made by the first call.
    const before = foreignRuns(f);
    expect(before).toHaveLength(1);

    f.commit({ "src/plain.ts": "export const value = 1; // b\n" });
    const asked = await run(
      f,
      { commit: a, paths, run: RUN, json: true, waitMs: 120_000 },
      options,
    );
    expect(rowOf(asked.out, LISTS.path)?.at, asked.err).toEqual({
      state: "not comparable",
      reason: storedReason("test/fixtures/"),
    });
    expect(asked.code).toBe(3);
    // The commit at `a` did not run the file: the call added the caller's run at `b` only.
    expect(foreignRuns(f), "a run of another worktree than the caller's").toEqual(before);
    // A stored result with no folder read is the commit's: read, not run there.
    const plain = rowOf(asked.out, PLAIN.path)?.at;
    expect(plain, asked.err).toMatchObject({ state: "pass" });
    expect(plain?.origin?.kind).not.toBe("commit");
  });
});
