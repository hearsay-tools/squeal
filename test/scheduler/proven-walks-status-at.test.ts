import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { run, withStore } from "../cli/status-at-kit.js";
import { realCommitDaemon } from "../cli/status-at-real-daemon.js";
import { type Fixture, fixture, git, link, write } from "../commit/at-keys-fixture.js";
import { childEnv, SLOW } from "../daemon/helpers.js";

/*
 * Review wave-23-third B2 (row 023-46, `tasks/023-46-notes.md`, Round 4),
 * the reviewer's public call with real daemons and real Vitest resolution:
 *
 * 1. At A, `test/foo.test.ts` imports extensionless `../src/foo`, which has
 *    no target. The main checkout's daemon walks it at key K and stops; its
 *    row stays at K, so pruning keeps that walk.
 * 2. Another worktree adds and commits `src/foo.js`. Its daemon walks the
 *    resolved closure, which names `src/foo.js` and not `src/foo.ts`, and
 *    becomes the newest stored list. It stops.
 * 3. The main checkout adds only `src/foo.ts` and calls
 *    `status --at A test --run`. The commit daemon at A keys that list at K.
 *    A walk row at K exists, but the list holds an import unresolved at A
 *    (`src/foo.js` is absent there), so it walks, and the change selects
 *    and runs the test. Before the repair: `notSelected`, nothing run.
 */

const FOO = "test/foo.test.ts";
const RUN = { allMissing: false };

/** A real worktree daemon of `root`, stopped once its start is done. */
async function startedAndStopped(root: AbsolutePath): Promise<void> {
  const runtime = realpathSync(mkdtempSync("/tmp/sq-pw-"));
  onTestFinished(() => rmSync(runtime, { recursive: true, force: true }));
  const daemon = await startDaemon({ root, env: childEnv(runtime) });
  if ("reason" in daemon) throw new Error(daemon.message);
  await daemon.ready;
  await daemon.stop("stop-requested");
}

/** The newest stored closure list of `path`. */
function storedList(f: Fixture, path: string): readonly string[] {
  let list: readonly string[] = [];
  withStore(f, (store) => {
    list = store.testFiles.get({ project: "", path })?.closure.paths ?? [];
  });
  return list;
}

describe(
  "status --at --run selects a file whose stored list holds an unresolved import (B2)",
  SLOW,
  () => {
    it("walks at the commit, keeps src/foo.ts among the candidates, and runs the test", {
      timeout: 300_000,
    }, async () => {
      const f = fixture({
        [FOO]:
          'import { it } from "vitest";\nimport { foo } from "../src/foo";\n\nit("foo", () => foo());\n',
      });
      const a = git(f.root, "rev-parse", "HEAD").trim();

      await startedAndStopped(f.root);
      expect(storedList(f, FOO)).toContain("src/foo.ts");

      const other = join(f.dir, "other") as AbsolutePath;
      git(f.root, "worktree", "add", "-q", "-b", "other", other, a);
      link(other);
      write(other, { "src/foo.js": "export const foo = () => {};\n" });
      git(other, "add", "-A");
      git(other, "commit", "-qm", "B: add foo.js");
      await startedAndStopped(realpathSync(other) as AbsolutePath);
      const list = storedList(f, FOO);
      expect(list).toContain("src/foo.js");
      expect(list).not.toContain("src/foo.ts");

      const options = {
        cacheRoot: f.cacheRoot as never,
        daemons: realCommitDaemon(f.root).daemons,
      };
      const call = async () => {
        const out = await run(
          f,
          { commit: a, paths: ["test"], json: true, run: RUN, waitMs: 120_000 },
          options,
        );
        const json = JSON.parse(out.out);
        const at = (json.files as { path: string; at: Record<string, unknown> }[]).find(
          (x) => x.path === FOO,
        )?.at;
        return { json, at };
      };

      // Untracked here: D4.9's closure query holds the candidate, so the commit side is refused.
      write(f.root, { "src/foo.ts": "export const foo = () => {};\n" });
      const untracked = await call();
      expect(untracked.at).toMatchObject({ state: "not comparable", reason: "needs src/foo.ts" });

      // Committed on a branch from A: the change selects the test, and the commit daemon runs it.
      git(f.root, "checkout", "-q", "-b", "with-foo-ts");
      git(f.root, "add", "src/foo.ts");
      git(f.root, "commit", "-qm", "C: add foo.ts");
      const { json, at } = await call();
      expect(json.notSelected.files).toBe(0);
      expect(json.run.commit.files).toBe(1);
      // At A no `src/foo.*` exists: the test fails to load there.
      expect(at).toMatchObject({ state: "fail" });
    });
  },
);
