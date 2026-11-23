import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { type AtDaemons, realDaemons } from "../../src/cli/status-at-daemons.js";
import { installCommitWorktree } from "../../src/core/checkout/commit-setup.js";
import { storedReason } from "../../src/core/daemon/at-asks.js";
import { COMMIT_WORKTREES } from "../../src/core/daemon/commit-mode.js";
import { type RunningDaemon, startDaemon } from "../../src/core/daemon/daemon.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fixture, git, linkInstall, ref, write } from "../commit/at-keys-fixture.js";
import { childEnv, SLOW } from "../daemon/helpers.js";
import { run, testOf } from "./status-at-kit.js";

/*
 * Row 023-70 (review 0.1.610, "outside this wave"; spec 023 D4.9 in the
 * commit daemon): a result the caller's worktree stored at a key the
 * commit shares is read as the commit side's only when D4.9 holds for the
 * tree that ran it. A folder read's key hashes the names git tracks there,
 * not the names the run saw; nothing records those, so a folder read holds
 * only for a result the commit worktree ran itself (row 023-64). Here the
 * caller stores a pass of `lists.test.ts` with an ignored `extra.log` in
 * the folder it lists, then deletes `extra.log`; the pristine commit fails
 * the file's two-name assertion. Before the fix the call read the caller's
 * pass as the commit's, "unchanged". A stored result with no folder read
 * still compares without a run at the commit.
 */

const LISTS = ref("test/lists.test.ts");
const PLAIN = ref("test/plain.test.ts");
const RUN = { allMissing: false };

/** A test that lists `test/fixtures/` and expects two names. */
const lists = [
  'import { readdirSync } from "node:fs";',
  'import { expect, it } from "vitest";',
  'import { value } from "../src/plain";',
  'it("lists", () => expect(readdirSync(new URL("./fixtures", import.meta.url)).length).toBe(2 * value));',
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

describe("a stored result passes D4.9 before the commit side reads it (row 023-70)", SLOW, () => {
  it("reads the caller's stored pass of a folder-listing file as not comparable, and compares a clean one", {
    timeout: 400_000,
  }, async () => {
    const f = fixture({
      "squeal.config.json": "{}\n",
      ".gitignore": "node_modules/\n*.log\n",
      "src/plain.ts": "export const value = 1;\n",
      "test/fixtures/a.json": "{}\n",
      [LISTS.path]: lists,
      [PLAIN.path]: testOf("plain", 1),
    });
    const z = git(f.root, "rev-parse", "HEAD").trim();
    const a = f.commit({ "src/plain.ts": "export const value = 1; // a\n" });
    const daemons = bothDaemons();
    const options = { cacheRoot: f.cacheRoot, daemons };
    const paths = [LISTS.path, PLAIN.path];

    // The caller at `a`, with an ignored name in the listed folder: its run of both files
    // stores passes at the keys `a` has (the listing's key hashes the tracked names only).
    write(f.root, { "test/fixtures/extra.log": "x" });
    const seeded = await run(
      f,
      { commit: z, paths, run: RUN, json: true, waitMs: 120_000 },
      options,
    );
    expect(rowOf(seeded.out, LISTS.path)?.now, seeded.err).toMatchObject({ state: "pass" });
    expect(rowOf(seeded.out, PLAIN.path)?.now, seeded.err).toMatchObject({ state: "pass" });

    // The caller deletes the name and moves on; nothing recorded what its run listed.
    rmSync(join(f.root, "test/fixtures/extra.log"));
    f.commit({ "src/plain.ts": "export const value = 1; // b\n" });
    const asked = await run(
      f,
      { commit: a, paths, run: RUN, json: true, waitMs: 120_000 },
      options,
    );

    // The pristine commit lists one name and fails; the caller's pass is not the commit's.
    expect(rowOf(asked.out, LISTS.path)?.at, asked.err).toEqual({
      state: "not comparable",
      reason: storedReason("test/fixtures/"),
    });
    // A stored result with no folder read is the commit's: read, not run there.
    const plain = rowOf(asked.out, PLAIN.path)?.at;
    expect(plain, asked.err).toMatchObject({ state: "pass" });
    expect(plain?.origin?.kind).not.toBe("commit");
  });
});
