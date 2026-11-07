import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readImportGraph } from "../../src/core/store/import-graph.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { RunnerClosure } from "../../src/core/types/runner.js";
import { SLOW } from "./cleanup.js";
import { createRepo, openRepoStore, ref } from "./repo.js";
import { openHarness } from "./vitest-harness.js";

/*
 * Row 015-119 (review 0.1.415-r3, B2-R3): a walk read before an edit is
 * never stored under the newer key. The scheduler judges a closure that
 * names a path a revision changed while its runner phase ran as changed
 * meanwhile and carries it; its walk stays unrecorded until the carried
 * fresh part supplies it. Both gateway versions give the same closure path
 * set (a.ts imports leaf.ts either way), so both parts key alike.
 */

const GATEWAY = "src/gateway.ts";
const TEST = "test/gate.test.ts";
const FILES: Readonly<Record<string, string>> = {
  "src/leaf.ts": "export const value = 1;\n",
  "src/a.ts": 'export { value } from "./leaf.js";\n',
  [GATEWAY]: 'export { value } from "./a.js";\nexport { value as other } from "./leaf.js";\n',
  [TEST]: [
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

describe("a walk read before an edit (015-119)", SLOW, () => {
  it("is never stored under the newer key: the carried fresh walk is, once the scheduler is idle", async () => {
    const repo = createRepo("basic");
    for (const [path, text] of Object.entries(FILES)) writeFileSync(join(repo.main, path), text);
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 1 });
    await h.scheduler.start();
    await h.scheduler.idle();
    const test = ref(TEST);

    // The next closure of the test file is held after the real adapter answered it.
    const original = h.runner.closure.bind(h.runner);
    const reached = deferred();
    const release = deferred();
    let hold = true;
    h.runner.closure = async (testFile: TestFileRef): Promise<RunnerClosure> => {
      const answer = await original(testFile);
      if (hold && testFile.path === TEST) {
        hold = false;
        reached.resolve();
        await release.promise;
      }
      return answer;
    };

    h.write(GATEWAY, `${FILES[GATEWAY]}// a comment\n`);
    const first = h.batch(GATEWAY);
    await reached.promise;
    // While the old walk is held: the gateway loses its direct leaf.js export.
    h.write(GATEWAY, 'export { value } from "./a.js";\n');
    await h.batch(GATEWAY);
    release.resolve();
    await first;
    await h.scheduler.idle();

    const fresh = await original(test);
    expect(fresh.imports?.find((f) => f.path === GATEWAY)?.static).toEqual(["src/a.ts"]);
    // Results are current and passing for the final bytes, at the key the graph is read by.
    const states = store.knownStates
      .list(h.worktreeId)
      .filter((s) => s.check.kind !== "setup" && s.check.testPath === TEST);
    expect(states.length).toBeGreaterThan(0);
    for (const state of states)
      expect(state).toMatchObject({ outcome: "pass", validity: "current" });
    const row = store.testFileKeys.list(h.worktreeId).find((r) => r.testFile.path === TEST);
    expect(row).toMatchObject({ pending: null });
    expect(row?.key).not.toBeNull();
    const walked = readImportGraph(store, h.worktreeId).walk(test);
    expect(walked?.imports.get(GATEWAY)?.static).toEqual(["src/a.ts"]);
    expect(h.errors).toEqual([]);
  });
});
