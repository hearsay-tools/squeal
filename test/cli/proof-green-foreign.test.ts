import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { readGreen } from "../../src/cli/proof-green-run.js";
import { idOf } from "../../src/cli/status-at-after.js";
import type { AtDaemons } from "../../src/cli/status-at-daemons.js";
import { commonDirOf, type KeyedFile } from "../../src/core/commit/at-keys-checkout.js";
import { storedReason } from "../../src/core/daemon/at-asks.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import type { CommitAskState } from "../../src/core/types/commit-ask.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { fixture, ref } from "../commit/at-keys-fixture.js";
import { result } from "../store/helpers.js";
import { withStore } from "./status-at-kit.js";

/*
 * Review 0.1.611 B1 in the proof (spec 023 D7.6, row 023-70): the green
 * side reads its files on the commit daemon at HEAD, through the same ask
 * as `status --at`. A file whose closure lists a folder (`ownOnly`) holds
 * only the commit worktree's result: another worktree's pass that arrived
 * at the shared key while the file was queued is unknown, with the
 * reason. A queued file ran on the commit daemon only when the commit
 * worktree wrote its result; another worktree's result at a shared key is
 * read from the store, not counted as this command's run.
 */

const LISTS = ref("test/lists.test.ts");
const PLAIN = ref("test/plain.test.ts");
const REASON = storedReason("test/fixtures/");
const CALLER = "wt-caller";

const keyOf = (r: TestFileRef): CheckKey => `key-${r.path}`;
// `readGreen` reads each file by its ref at the daemon's live key; the checkout's key is not used.
const keyed = (r: TestFileRef): KeyedFile => ({ ref: r }) as unknown as KeyedFile;

/** A queued green ask of both files, `LISTS` reading a folder, and the store `stored` fills. */
async function green(
  stored: readonly {
    ref: TestFileRef;
    by: "commit" | "caller";
    outcome?: "pass" | "fail";
    test?: string;
  }[],
) {
  const f = fixture({ "squeal.config.json": "{}\n" });
  const tree = realpathSync(mkdtempSync(join(tmpdir(), "sq-green-tree-"))) as AbsolutePath;
  onTestFinished(() => rmSync(tree, { recursive: true, force: true }));
  const treeId = idOf(tree);
  withStore(f, (store) => {
    store.testFileKeys.upsertMany(
      [LISTS, PLAIN].map((testFile) => ({
        worktreeId: treeId,
        testFile,
        key: keyOf(testFile),
        revision: 1,
        pending: null,
      })),
    );
    store.results.putMany(
      stored.map(({ ref: r, by, outcome, test }, n) =>
        result(
          { kind: "test", project: r.project, testPath: r.path, fullName: test ?? "lists" },
          keyOf(r),
          {
            outcome: outcome ?? "pass",
            worktreeId: by === "commit" ? treeId : CALLER,
            runId: `run-${n}`,
          },
        ),
      ),
    );
  });
  const own: CommitAskState = {
    owner: "proof-1",
    phase: "queued",
    files: [LISTS, PLAIN],
    readers: {},
    problems: [],
    ownOnly: [{ ref: LISTS, reason: REASON }],
  };
  const daemons = { wait: async () => null } as unknown as AtDaemons;
  const input = {
    daemons,
    root: f.root,
    tree,
    commonDir: commonDirOf(f.root),
    by: Date.now() + 60_000,
    at: "abc123456",
  };
  const sides = await readGreen(input, { own }, [keyed(LISTS), keyed(PLAIN)], "proof-1");
  return (r: TestFileRef) => sides.get(testFileId(r));
}

describe("the proof's green side judges each result by its writer (review 0.1.611 B1)", () => {
  it("reads another worktree's folder result as unknown, whenever it arrived", async () => {
    const side = await green([{ ref: LISTS, by: "caller" }]);
    expect(side(LISTS)).toEqual({
      end: { end: "unknown", reason: REASON },
      from: null,
      stored: false,
      notStored: null,
      runs: 0,
    });
  });

  it("reads another worktree's pass at a shared key as stored, not as this command's run", async () => {
    const side = await green([{ ref: PLAIN, by: "caller" }]);
    expect(side(PLAIN)).toMatchObject({ end: { end: "pass" }, from: "store", runs: 0 });
  });

  it("reads the commit worktree's own results as this command's runs, beside another worktree's", async () => {
    const side = await green([
      // The store keeps one record per test and key: the caller's is of another test in the file.
      { ref: LISTS, by: "commit", outcome: "fail" },
      { ref: LISTS, by: "caller", test: "counts" },
      { ref: PLAIN, by: "commit" },
    ]);
    expect(side(LISTS)).toMatchObject({ end: { end: "fail" }, from: "run", runs: 1 });
    expect(side(PLAIN)).toMatchObject({ end: { end: "pass" }, from: "run", runs: 1 });
  });
});
