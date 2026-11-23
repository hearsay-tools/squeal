import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { liveDaemon } from "./status-at-daemon.js";
import { check, run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-59 (dogfood round 7, W2): a `--wait` that joins files still
 * running names those that have a result once it ends, per side, so an
 * agent does not keep calling them "still running" from an earlier call.
 */

const A = ref("test/a.test.ts");
const B = ref("test/b.test.ts");
const C = ref("test/c.test.ts");

/** The rows of the daemon of `id`: `files` at key `<prefix><path>`, pending as `pending`. */
function rowsOf(
  f: Fixture,
  id: string,
  prefix: string,
  files: readonly TestFileRef[],
  pending: "running" | null,
) {
  withStore(f, (store) =>
    store.testFileKeys.upsertMany(
      files.map((testFile) => ({
        worktreeId: id,
        testFile,
        key: `${prefix}${testFile.path}`,
        revision: 2,
        pending,
      })),
    ),
  );
}

/** Each of `files` gets a pass at key `<prefix><path>`, and its row's pending mark is cleared. */
function passed(f: Fixture, id: string, prefix: string, files: readonly TestFileRef[]) {
  rowsOf(f, id, prefix, files, null);
  withStore(f, (store) =>
    store.results.putMany(files.map((r) => result(check(r.path), `${prefix}${r.path}`))),
  );
}

describe("a --wait names what went from running to a result (row 023-59, W2)", SLOW, () => {
  it("names the files on each side that have a result once the wait ends", async () => {
    const f = fixture({
      "src/a.ts": "export const value = 1;\n",
      [A.path]: testOf("a", 1),
      [B.path]: testOf("a", 1),
      [C.path]: testOf("a", 1),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 1; // b\n" });
    const tree: AbsolutePath = standInTree(f);
    const atId = worktreeIdFor(tree);
    // At the commit, A and B run; in the working tree (a live daemon), A and C run.
    rowsOf(f, atId, "commit-", [A, B], "running");
    withStore(f, (store) => liveDaemon(f, store, [A, B, C]));
    const nowId = worktreeIdFor(f.root);
    rowsOf(f, nowId, "daemon-", [A, C], "running");
    // The wait ends with A done at the commit and C done in the working tree.
    const onWait = (root: string) => {
      if (root === tree) passed(f, atId, "commit-", [A]);
      if (root === f.root) passed(f, nowId, "daemon-", [C]);
    };
    const base = standIn(tree, onWait);
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install, daemons: base.ports };
    const joined = await run(f, { commit: a, waitMs: 3000 }, options);
    const at = a.slice(0, 9);
    expect(joined.out).toContain(
      `--wait: 1 test file went from running to a result at ${at}: ${A.path}\n`,
    );
    expect(joined.out).toContain(
      `--wait, now: 1 test file went from running to a result in the working tree: ${C.path}\n`,
    );
    const json = JSON.parse((await run(f, { commit: a, waitMs: 3000, json: true }, options)).out);
    // Nothing more ran: the second join names nothing.
    expect(json.run.resolved).toBeUndefined();
  });
});
