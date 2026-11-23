import { describe, expect, it } from "vitest";
import { type AtAskPorts, choose } from "../../src/core/daemon/at-asks.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import type { CommitAskRequest } from "../../src/core/types/commit-ask.js";
import type { AbsolutePath, RelativePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { liveDaemon } from "./status-at-daemon.js";
import { check, run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Review 0.1.607 B2 (row 023-58, W1): a bare `--wait` that names files
 * with a result on one side and none on the other promised that a wide
 * `--run` queues all of them, while the daemon's selection (`choose`)
 * queued only the one the change selects. The line now counts exactly
 * what the suggested call queues, from a kept ask of the same change,
 * paths and no `--all-missing`, or says it queues those it selects when
 * no kept ask tells. Each case runs the printed call and compares.
 * Review 0.1.609 B2: the working tree takes the commit's selection by
 * path in any project, so the count does too.
 */

const A = ref("test/a.test.ts");
const B = ref("test/b.test.ts");

/** Commit A: `test/a` reads `src/a.ts`, `test/b` reads `src/b.ts`; HEAD changes `src/a.ts`. */
function changed() {
  const f = fixture({
    "src/a.ts": "export const value = 1;\n",
    "src/b.ts": "export const value = 1;\n",
    [A.path]: testOf("a", 1),
    [B.path]: testOf("b", 1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 1; // b\n" });
  return { f, a };
}

/** The commit daemon's rows of A and B at `commit-<path>`, a pass there for `passing`. */
function atCommit(f: Fixture, tree: AbsolutePath, passing: readonly TestFileRef[]) {
  withStore(f, (store) => {
    store.testFileKeys.upsertMany(
      [A, B].map((testFile) => ({
        worktreeId: worktreeIdFor(tree),
        testFile,
        key: `commit-${testFile.path}`,
        revision: 2,
        pending: null,
      })),
    );
    store.results.putMany(passing.map((r) => result(check(r.path), `commit-${r.path}`)));
  });
}

/** The daemon's real selection rule over those rows: the change selects the readers of its paths. */
function selection(passing: readonly TestFileRef[]) {
  const reads = new Map([
    [A.path, "src/a.ts"],
    [B.path, "src/b.ts"],
  ]);
  const ports = {
    rows: () => [A, B].map((testFile) => ({ testFile, key: `commit-${testFile.path}` })),
    changedSelects: async (paths: readonly RelativePath[]) =>
      [A, B].filter((r) => paths.includes(r.path) || paths.includes(reads.get(r.path) as never)),
    stored: (r: TestFileRef) => passing.some((p) => p.path === r.path),
    needs: async () => new Map(),
  } as unknown as AtAskPorts;
  return async (ask: Omit<CommitAskRequest, "type">) => {
    const chosen = await choose({ type: "commit-ask", ...ask }, ports);
    if (chosen === null) throw new Error("no selection");
    return { files: [...chosen.named, ...chosen.rest], withResult: chosen.withResult };
  };
}

/** The call a line suggests, between backticks. */
function suggested(out: string): string {
  const command = /`(squeal status --at [^`]+)`/.exec(out)?.[1];
  if (command === undefined) throw new Error(`no suggested call in:\n${out}`);
  return command;
}

const options = (f: Fixture, base: ReturnType<typeof standIn>) => ({
  cacheRoot: f.cacheRoot,
  install: linkInstall().install,
  daemons: base.ports,
});

describe("a join's recovery line counts what its call queues (review 0.1.607 B2)", SLOW, () => {
  it("after a wide --run, counts only the file the change selects, and the call queues it", async () => {
    const { f, a } = changed();
    const tree = standInTree(f);
    atCommit(f, tree, [A, B]);
    const base = standIn(tree, () => undefined, { choose: selection([A, B]) });
    const opts = options(f, base);
    await run(f, { commit: a, run: { allMissing: false }, waitMs: 1000 }, opts);
    const joined = await run(f, { commit: a, waitMs: 1000 }, opts);
    const at = a.slice(0, 9);
    expect(joined.out).toContain(
      `now: 2 test files with a result at ${at} have none in the working tree, and none is queued or running there; \`squeal status --at ${a} --run\` queues 1 of them; it does not select the other 1\n`,
    );
    const json = JSON.parse((await run(f, { commit: a, waitMs: 1000, json: true }, opts)).out);
    expect(json.run.idle).toMatchObject({ now: 2, queues: { now: 1 } });
    // The printed call, run: the working tree is asked exactly the one file promised.
    expect(suggested(joined.out)).toBe(`squeal status --at ${a} --run`);
    const before = base.asks.length;
    await run(f, { commit: a, run: { allMissing: false }, waitMs: 1000 }, opts);
    const asked = base.asks.slice(before).filter((ask) => ask.root === f.root);
    expect(asked.flatMap((ask) => [...ask.paths])).toEqual([A.path]);
  });

  it("with no kept ask, promises no count it cannot prove", async () => {
    const { f, a } = changed();
    const tree = standInTree(f);
    atCommit(f, tree, [A, B]);
    const base = standIn(tree, () => undefined, { choose: selection([A, B]) });
    const opts = options(f, base);
    const joined = await run(f, { commit: a, waitMs: 1000 }, opts);
    expect(joined.out).toContain(
      `none is queued or running there; \`squeal status --at ${a} --run\` queues those of them it selects\n`,
    );
    expect(joined.out).not.toMatch(/--run` queues them\n/);
    const json = JSON.parse((await run(f, { commit: a, waitMs: 1000, json: true }, opts)).out);
    expect(json.run.idle).toMatchObject({ now: 2, queues: { now: null } });
    expect(base.asks).toEqual([]);
  });

  it("the commit side: no count without a kept ask, the exact one with it", async () => {
    const { f, a } = changed();
    const tree = standInTree(f);
    // No result at the commit; both pass in the working tree (a live daemon).
    atCommit(f, tree, []);
    withStore(f, (store) => {
      liveDaemon(f, store, [A, B]);
      store.results.putMany(
        [A, B].map((r) =>
          result(check(r.path), `daemon-${r.path}`, { worktreeId: worktreeIdFor(f.root) }),
        ),
      );
    });
    const base = standIn(tree, () => undefined, { choose: selection([]) });
    const opts = options(f, base);
    const at = a.slice(0, 9);
    const line = (n: number) =>
      `${n} test file${n === 1 ? "" : "s"} with a result in the working tree ${n === 1 ? "has" : "have"} none at ${at}, and none is queued or running there; \`squeal status --at ${a} --run\``;
    const first = await run(f, { commit: a, waitMs: 1000 }, opts);
    expect(first.out).toContain(`${line(2)} queues those of them it selects\n`);
    // A wide --run: the change selects A only. Its kept ask tells the selection.
    await run(f, { commit: a, run: { allMissing: false }, waitMs: 1000 }, opts);
    expect(base.commitAsks.at(-1)?.named).toEqual([]);
    const joined = await run(f, { commit: a, waitMs: 1000 }, opts);
    expect(joined.out).toContain(`${line(1)} queues it\n`);
    // The printed call, run: the commit daemon queues exactly that one file.
    const before = base.commitAsks.length;
    await run(f, { commit: a, run: { allMissing: false }, waitMs: 1000 }, opts);
    expect(base.commitAsks.length).toBe(before + 1);
    const chosen = await selection([])(base.commitAsks.at(-1) as never);
    expect(chosen.files).toEqual([A]);
  });

  it("counts the selected path in every project the --run queues it in (review 0.1.609 B2)", async () => {
    // Projects a, b and c list one test path; the change selects it at the commit in a only.
    const config = `export default { test: { projects: [${["a", "b", "c"]
      .map((name) => `{ test: { name: "${name}", include: ["test/*.test.ts"] } }`)
      .join(", ")}] } };\n`;
    const shared = "test/shared.test.ts" as RelativePath;
    const f = fixture({
      "vitest.config.mjs": config,
      "src/shared.ts": "export const value = 1;\n",
      [shared]: testOf("shared", 1),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/shared.ts": "export const value = 1; // b\n" });
    const refs = ["a", "b", "c"].map((project): TestFileRef => ({ project, path: shared }));
    const fileCheck = (r: TestFileRef) =>
      ({ kind: "file", project: r.project, testPath: r.path }) as const;
    const tree = standInTree(f);
    withStore(f, (store) => {
      store.testFileKeys.upsertMany(
        refs.map((testFile) => ({
          worktreeId: worktreeIdFor(tree),
          testFile,
          key: `commit-${testFile.project}`,
          revision: 2,
          pending: null,
        })),
      );
      store.results.putMany(refs.map((r) => result(fileCheck(r), `commit-${r.project}`)));
    });
    const ports = {
      rows: () => refs.map((testFile) => ({ testFile, key: `commit-${testFile.project}` })),
      changedSelects: async () => [refs[0]],
      stored: () => true,
      needs: async () => new Map(),
    } as unknown as AtAskPorts;
    const waited: TestFileRef[][] = [];
    const base = standIn(
      tree,
      (root, files) => {
        if (root === f.root) waited.push([...files]);
      },
      {
        choose: async (ask) => {
          const chosen = await choose({ type: "commit-ask", ...ask }, ports);
          if (chosen === null) throw new Error("no selection");
          return { files: [...chosen.named, ...chosen.rest], withResult: chosen.withResult };
        },
      },
    );
    const opts = options(f, base);
    // The sibling in c already has a result in the working tree, at the key the daemon gives it.
    await run(f, { commit: a, waitMs: 1000 }, opts);
    withStore(f, (store) => {
      const row = store.testFileKeys
        .list(worktreeIdFor(f.root))
        .find((r) => r.testFile.project === "c");
      if (row?.key == null) throw new Error("project c not keyed in the working tree");
      store.results.putMany([
        result(fileCheck(refs[2] as TestFileRef), row.key, { worktreeId: worktreeIdFor(f.root) }),
      ]);
    });
    await run(f, { commit: a, run: { allMissing: false }, waitMs: 1000 }, opts);
    expect(base.commitAsks.at(-1)?.named).toEqual([]);
    const joined = await run(f, { commit: a, waitMs: 1000 }, opts);
    const at = a.slice(0, 9);
    expect(joined.out).toContain(
      `now: 2 test files with a result at ${at} have none in the working tree, and none is queued or running there; \`squeal status --at ${a} --run\` queues them\n`,
    );
    const json = JSON.parse((await run(f, { commit: a, waitMs: 1000, json: true }, opts)).out);
    expect(json.run.idle).toMatchObject({ now: 2, queues: { now: 2 } });
    // The printed call, run: the working tree waits for a and b, never c, which has its result.
    expect(suggested(joined.out)).toBe(`squeal status --at ${a} --run`);
    waited.length = 0;
    await run(f, { commit: a, run: { allMissing: false }, waitMs: 1000 }, opts);
    const requested = new Set(waited.flat().map(testFileId));
    expect([...requested].sort()).toEqual(
      [testFileId(refs[0] as TestFileRef), testFileId(refs[1] as TestFileRef)].sort(),
    );
    expect(requested.size).toBe(json.run.idle.queues.now);
  });
});
