import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { clean, run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-29 (lessons round 4, R8) on a `$TMPDIR` git fixture with the
 * real Vitest adapter: a file with no result at the commit that `--run`
 * did not select is marked so, and the run's count says it is of the
 * selected files only. Round 4's s7-04 read "9 of 9 … ran" beside such a
 * file and claimed a result at the parent for it.
 */

const TEST = ref("test/a.test.ts");
const PLAIN = ref("test/plain.test.ts");

/** Commit A: `a.test.ts` and `plain.test.ts`; HEAD changes `src/a.ts` and `a.test.ts` only. */
function changedA() {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 1;\n",
    [TEST.path]: testOf("a", 1),
    "src/plain.ts": "export const value = 1;\n",
    [PLAIN.path]: testOf("plain", 1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: testOf("a", 2) });
  // Row 023-40: stand-in daemons record what `--run` queues; row 023-40c: the commit daemon
  // lists both files and selects what the change selects (TEST), or the file the call names.
  const tree = standInTree(f);
  const queued = (files: readonly TestFileRef[], pending: "queued" | null) =>
    withStore(f, (store) =>
      store.testFileKeys.upsertMany(
        files.map((testFile) => ({
          worktreeId: worktreeIdFor(tree),
          testFile,
          key: `commit-${testFile.path}`,
          revision: 2,
          pending,
        })),
      ),
    );
  queued([TEST, PLAIN], null);
  const daemons = standIn(tree, () => undefined, {
    select: (ask) => (ask.named.includes(PLAIN.path) ? [PLAIN] : [TEST]),
    rows: (_at, files) => queued(files, "queued"),
  });
  const options = {
    cacheRoot: f.cacheRoot,
    install: linkInstall().install,
    daemons: daemons.ports,
  };
  return { f, a, tree, daemons, options };
}

const RUN = { allMissing: false };
type Side = Record<string, unknown>;
const fileOf = (out: string, path: string) =>
  (JSON.parse(out).files as { path: string; at: Side; now: Side }[]).find((x) => x.path === path);

describe(
  "status --at --run marks the files the change did not select (row 023-29, R8)",
  SLOW,
  () => {
    it("names the unselected file with --all-missing, in text and JSON, and counts it", async () => {
      const { f, a, tree, daemons, options } = changedA();
      const at = a.slice(0, 9);
      // A folder selects both files; it names neither of them itself.
      const text = await run(f, { commit: a, paths: ["test"], run: RUN }, options);
      expect(text.out).toContain(
        // Row 023-35 (T2): Vitest tells no incomplete closures, so Squeal does not vouch for it.
        `${PLAIN.path}: no result at ${at}, not selected by the change, and its runner does not tell whether the static closure is complete; \`--all-missing\` runs it; now `,
      );
      expect(text.out).toContain(
        `--run: queued 1 test files with no result at ${at} in its commit daemon (its worktree ${tree}); 0 have a result now`,
      );
      expect(daemons.commitAsks.map((ask) => ask.named)).toEqual([["test"]]);
      expect(text.out).toContain(
        `1 more with no result at ${at} not selected by the change did not run; \`--all-missing\` runs it`,
      );
      expect(text.out).not.toContain(`${TEST.path}: no result at ${at}, not selected`);

      const json = await run(f, { commit: a, json: true, paths: ["test"], run: RUN }, options);
      expect(fileOf(json.out, PLAIN.path)?.at).toMatchObject({
        state: "no result",
        notSelected: true,
        closure: "unchecked",
      });
      expect(JSON.parse(json.out).notSelected).toEqual({
        files: 0,
        excepted: [{ project: "", path: PLAIN.path, closure: "unchecked" }],
      });
      expect(JSON.parse(json.out).run).toMatchObject({ commit: { files: 1 }, notSelected: 1 });
      clean(f);
    });
  },
);

describe(
  "status --at <file> --run runs the file it names (row 023-29, row 023-32's finding)",
  SLOW,
  () => {
    it("runs a named test file the change does not select, on both sides", async () => {
      const { f, a, tree, daemons, options } = changedA();
      const at = a.slice(0, 9);
      // On 0.1.577: "no file with no result at <commit> to run" beside the file's own `no result`.
      const text = await run(f, { commit: a, paths: [PLAIN.path], run: RUN }, options);
      expect(text.out).not.toContain("no file with no result");
      expect(text.out).not.toContain("not selected by the change");
      // Row 023-40: queued on both sides, in each daemon, the named file leading.
      expect(daemons.commitAsks.map((ask) => ask.named)).toEqual([[PLAIN.path]]);
      expect(daemons.asks.map((ask) => [ask.root, ask.paths, ask.call.lead])).toEqual([
        [f.root, [PLAIN.path], true],
      ]);
      expect(text.out).toContain(
        `--run: queued 1 test files with no result at ${at} in its commit daemon (its worktree ${tree})`,
      );
      expect(text.out).toContain(
        "--run, now: queued 1 test files the change selects with no result in the working tree in this worktree's daemon",
      );
      clean(f);
    });
  },
);
