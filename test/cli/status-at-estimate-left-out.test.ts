import { describe, expect, it } from "vitest";
import type { AtDaemons } from "../../src/cli/status-at-daemons.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { PAYLOAD_SCHEMA_VERSION } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-62 (dogfood round 7, V2's rest): s1's working-tree estimate,
 * "about 14 to 35 min for 106 files", counted 97 browser files whose
 * batch's setup had already failed at the parent in the same call; the 13
 * unit files had both sides in about 200 s. A side's estimate now leaves
 * out the files whose setup failed on the other side, and names them.
 */

const A = ref("test/a.test.ts");
const B = ref("test/b.test.ts");

describe("the estimate leaves out a setup failed on the other side (row 023-62)", SLOW, () => {
  it("counts only the working tree's files whose commit side did not fail its setup", async () => {
    const f = fixture({
      "src/a.ts": "export const value = 1;\n",
      [A.path]: testOf("a", 1),
      [B.path]: testOf("a", 1),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 1; // b\n" });
    const tree = standInTree(f);
    // At the commit, B still runs; A, which its daemon does not list, reads "not run" (setup).
    withStore(f, (store) =>
      store.testFileKeys.upsertMany([
        {
          worktreeId: worktreeIdFor(tree),
          testFile: B,
          key: "k-b",
          revision: 2,
          pending: "running",
        },
      ]),
    );
    // The working tree's daemon took both and runs them.
    const running = (root: string, files: readonly TestFileRef[]) => {
      if (root !== f.root) return;
      const ids = new Set(files.map(testFileId));
      withStore(f, (store) => {
        const id = worktreeIdFor(f.root);
        const rows = store.testFileKeys.list(id).filter((r) => ids.has(testFileId(r.testFile)));
        store.testFileKeys.upsertMany(rows.map((r) => ({ ...r, pending: "queued" as const })));
      });
    };
    const base = standIn(tree, running, { select: () => [B] });
    const daemons: AtDaemons = {
      ...base.ports,
      async commitRead() {
        return {
          schemaVersion: PAYLOAD_SCHEMA_VERSION,
          ok: true,
          type: "commit-read",
          setup: { phase: "failed", text: "browser: setup failed" },
          asks: [],
        };
      },
    };
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install, daemons };
    const args = { commit: a, paths: ["test"], run: { allMissing: false }, waitMs: 2000 };
    const json = JSON.parse((await run(f, { ...args, json: true }, options)).out);
    expect(json.run.estimate.now).toMatchObject({ files: 1, leftOut: 1 });
    const text = await run(f, args, options);
    expect(text.out).toMatch(
      new RegExp(
        `in the working tree: 1 test file, time unknown: [^;]*; 1 test file left out, its batch's setup failed at ${a.slice(0, 9)} in this call`,
      ),
    );
  });
});
