import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { closureFor } from "../../src/core/delivery/closure.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { readSnapshot } from "../../src/core/reach/read.js";
import { buildReport } from "../../src/core/reach/report.js";
import { rewalkMetaKey } from "../../src/core/scheduler/import-rewalk.js";
import { readImportGraph } from "../../src/core/store/import-graph.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { RunnerClosure } from "../../src/core/types/runner.js";
import type { Store } from "../../src/core/types/store.js";
import { SLOW } from "./cleanup.js";
import { addWorktree, createRepo, openRepoStore, ref } from "./repo.js";
import { type Harness, openHarness } from "./vitest-harness.js";

/*
 * Row 015-117 (P1, lessons "Edit reach, round 1" defect 1): after an
 * upgrade the daemon reads, once, the imports of every listed test file
 * whose current key has no stored walk. Here a first daemon stores
 * closures and results, its walks are dropped as a store from before the
 * walks would hold none, and the next daemon starts lookup-only.
 */

const GATEWAY = "src/gateway.ts";
const GATE = "test/gate.test.ts";
const FILES: Readonly<Record<string, string>> = {
  "src/leaf.ts": "export const value = 1;\n",
  "src/a.ts": 'export { value } from "./leaf.js";\n',
  [GATEWAY]: 'export { value } from "./a.js";\nexport { value as other } from "./leaf.js";\n',
  [GATE]: [
    'import { expect, it } from "vitest";',
    'import { value } from "../src/gateway.js";',
    'it("g", () => expect(value).toBe(1));',
    "",
  ].join("\n"),
};

/** A promise and its resolver. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The repository after a first daemon ran it: closures, keys and results, and its walks dropped. */
async function upgraded(): Promise<{ repo: ReturnType<typeof createRepo>; store: Store }> {
  const repo = createRepo("basic");
  for (const [path, text] of Object.entries(FILES)) writeFileSync(join(repo.main, path), text);
  const store = openRepoStore(repo.commonDir);
  const first = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 2,
    policy: { baseline: { onStart: "lookup-then-run-missing" } },
  });
  await first.scheduler.start();
  await first.scheduler.idle();
  await first.scheduler.close();
  connectionOf(store).run("DELETE FROM test_file_imports");
  return { repo, store };
}

/** A lookup-only daemon over the same store, its closure calls counted from the start. */
async function next(repo: ReturnType<typeof createRepo>, store: Store) {
  const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 2 });
  const original = h.runner.closure.bind(h.runner);
  const walked: string[] = [];
  const hooks = { closure: original };
  h.runner.closure = (testFile: TestFileRef): Promise<RunnerClosure> => {
    walked.push(testFile.path);
    return hooks.closure(testFile);
  };
  return { h, walked, hooks, original };
}

const keysOf = (h: Harness) =>
  new Map(h.store.testFileKeys.list(h.worktreeId).map((r) => [r.testFile.path, r.key]));

describe("the once-after-upgrade re-walk (015-117)", SLOW, () => {
  it("walks every listed test file whose key has no walk, with no run and no key change", async () => {
    const { repo, store: shared } = await upgraded();
    const { h, walked } = await next(repo, shared);
    const keysBefore = keysOf(h);
    await h.scheduler.start();
    await h.scheduler.idle();

    const listed = shared.testFileKeys.list(h.worktreeId);
    expect(listed.length).toBeGreaterThan(1);
    const graph = readImportGraph(shared, h.worktreeId);
    for (const row of listed) expect(graph.walk(row.testFile), row.testFile.path).toBeDefined();
    expect([...walked].sort()).toEqual(listed.map((r) => r.testFile.path).sort());
    expect(h.runner.runs).toEqual([]);
    expect(keysOf(h)).toEqual(keysBefore);
    expect(shared.meta.get(rewalkMetaKey(h.worktreeId))).toBe("0.0.0-test");
  });

  it("does not walk again at a second start of the same version", async () => {
    const { repo, store: shared } = await upgraded();
    const second = await next(repo, shared);
    await second.h.scheduler.start();
    await second.h.scheduler.idle();
    await second.h.scheduler.close();
    connectionOf(shared).run("DELETE FROM test_file_imports");

    const third = await next(repo, shared);
    await third.h.scheduler.start();
    await third.h.scheduler.idle();
    expect(third.walked).toEqual([]);
    expect(readImportGraph(shared, third.h.worktreeId).walk(ref(GATE))).toBeUndefined();
  });

  it("lets an edit during the walk win: the walk read before it is not stored", async () => {
    const { repo, store: shared } = await upgraded();
    const { h, hooks, original } = await next(repo, shared);
    const reached = deferred();
    const release = deferred();
    let hold = true;
    hooks.closure = async (testFile) => {
      const answer = await original(testFile);
      if (hold && testFile.path === GATE) {
        hold = false;
        reached.resolve();
        await release.promise;
      }
      return answer;
    };
    await h.scheduler.start();
    await reached.promise;
    // The re-walk holds the gateway's old imports; the edit drops its direct leaf.js export.
    h.write(GATEWAY, 'export { value } from "./a.js";\n');
    await h.batch(GATEWAY);
    release.resolve();
    await h.scheduler.idle();

    const fresh = await original(ref(GATE));
    expect(fresh.imports?.find((f) => f.path === GATEWAY)?.static).toEqual(["src/a.ts"]);
    const walk = readImportGraph(shared, h.worktreeId).walk(ref(GATE));
    expect(walk?.imports.get(GATEWAY)?.static).toEqual(["src/a.ts"]);
    expect(h.errors).toEqual([]);
  });

  /*
   * R1 0.1.416 (review 0.1.416 B1): a peer worktree wrote the shared closure
   * last, at its own key, so closureFor does not give this worktree that
   * closure. The walk the re-walk stores at this worktree's current key is
   * trusted evidence of the test file's closure, as valid as its result,
   * and the report counts the file through it.
   */
  it("lets the report count a test file whose shared closure a peer wrote last", async () => {
    const repo = createRepo("basic");
    const other = addWorktree(repo.main, repo.dir, "other");
    for (const root of [repo.main, other]) {
      for (const [path, text] of Object.entries(FILES)) writeFileSync(join(root, path), text);
    }
    // Only a comment differs: the same closure paths, another key.
    writeFileSync(join(other, "src/leaf.ts"), `// the peer's comment\n${FILES["src/leaf.ts"]}`);
    const shared = openRepoStore(repo.commonDir);
    for (const root of [repo.main, other]) {
      const h = await openHarness(root, shared, repo.commonDir, {
        tierSize: 2,
        policy: { baseline: { onStart: "lookup-then-run-missing" } },
      });
      await h.scheduler.start();
      await h.scheduler.idle();
      await h.scheduler.close();
    }
    // A store from before the walks: closures and results, no walk and no marker.
    connectionOf(shared).run("DELETE FROM test_file_imports");
    shared.meta.delete(rewalkMetaKey(worktreeIdFor(repo.main)));

    const { h, walked } = await next(repo, shared);
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(walked).toContain(GATE);
    expect(h.runner.runs).toEqual([]);
    expect(closureFor(shared, h.worktreeId)(ref(GATE))).toBeUndefined();
    expect(readImportGraph(shared, h.worktreeId).walk(ref(GATE))).toBeDefined();

    const { snapshot, listed } = readSnapshot({ store: shared, root: repo.main, code: null });
    const report = buildReport(snapshot, { paths: null, limit: null, command: "squeal", listed });
    expect(report.suite.withoutClosure).toBe(0);
    const entry = (file: string) => report.files.find((e) => e.files.includes(file));
    for (const file of ["src/gateway.ts", "src/a.ts", "src/leaf.ts"]) {
      expect(entry(file), file).toMatchObject({ testFiles: 1 });
    }
    expect(entry("src/gateway.ts")?.kinds).toEqual({ direct: 1 });
  });
});
