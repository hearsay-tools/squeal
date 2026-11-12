import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import type { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import { storeClosures } from "../../src/core/scheduler/revision.js";
import { readImportGraph } from "../../src/core/store/import-graph.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/policy.js";
import type { RunnerClosure } from "../../src/core/types/runner.js";
import {
  ENVIRONMENT,
  head,
  keysOn,
  READER,
  repo,
  useDescriptorRepo,
} from "../delivery/descriptor-fixture.js";

/*
 * Spec 021 D21.1 (row 021-28): the daemon keeps each test file's runner
 * closure without `imports`, which were 53% of an idle daemon's live heap
 * (`research/daemon-heap.md` 1). The part the runner fetched still carries
 * them to the import-graph write, so the graph is stored as before; no key
 * reads them, so a test file's key is the same with or without them.
 */

useDescriptorRepo();

const WALKED: RunnerClosure = {
  testFile: READER,
  paths: [READER.path, "src/a.ts"],
  packages: { imports: [{ from: "", name: "vitest" }], builtins: ["fs"] },
  imports: [
    { path: READER.path, sha1: "s1", static: ["src/a.ts"], dynamic: [] },
    { path: "src/a.ts", sha1: "s2", static: [], dynamic: [] },
  ],
};

const { imports: _, ...UNWALKED } = WALKED;
const POLICY: Policy = { ...DEFAULT_POLICY, observe: { runtimeInputs: false } };

/** Keys with the environment read, as a daemon has them before its first closure. */
async function started(): Promise<WorktreeKeys> {
  const keys = keysOn(POLICY);
  await keys.bootstrap(head);
  await keys.setEnvironments([ENVIRONMENT]);
  return keys;
}

/** A refinement's closure step: keyed, then the closure and its walk stored in one transaction. */
async function resolve(keys: WorktreeKeys, closure: RunnerClosure): Promise<void> {
  keys.setClosure(closure);
  await keys.trackUntracked();
  const context = {
    store: repo.store,
    keys,
    worktreeId: worktreeIdFor(repo.root),
    now: () => 1_000,
  } as unknown as SchedulerContext;
  storeClosures(context, [closure.testFile], { closures: [closure] });
  // The daemon's sink stores the key the walk was written with (`readImportGraph` reads by it).
  repo.store.testFileKeys.upsertMany([
    {
      worktreeId: worktreeIdFor(repo.root),
      testFile: READER,
      key: keys.index.key(READER),
      revision: 1,
      pending: null,
    },
  ]);
}

describe("closures kept without imports (D21.1)", () => {
  it("keeps the runner's closure without `imports`, and the import graph is still written", async () => {
    const keys = await started();
    await resolve(keys, WALKED);

    const kept = keys.keptClosure(READER);
    expect(kept).toEqual(UNWALKED);
    expect(kept !== undefined && "imports" in kept).toBe(false);
    // The fetched part is the caller's: it keeps its imports.
    expect(WALKED.imports).toHaveLength(2);
    const walk = readImportGraph(repo.store, worktreeIdFor(repo.root)).walk(READER);
    expect(walk?.imports.get(READER.path)).toEqual({ static: ["src/a.ts"], dynamic: [] });
    expect(walk?.imports.get("src/a.ts")).toEqual({ static: [], dynamic: [] });
  });

  it("keys a test file the same as a closure without `imports`, then and when re-assembled", async () => {
    const walked = await started();
    await resolve(walked, WALKED);
    const unwalked = await started();
    await resolve(unwalked, UNWALKED);
    expect(walked.index.key(READER)).not.toBeNull();
    expect(walked.index.key(READER)).toBe(unwalked.index.key(READER));

    // A policy change re-assembles every kept closure: still no `imports`, and the same key.
    const policy: Policy = { ...POLICY, inputs: ["src/*.ts"] };
    walked.setPolicy(policy);
    unwalked.setPolicy(policy);
    expect(walked.keptClosure(READER)).toEqual(UNWALKED);
    expect(walked.index.key(READER)).toBe(unwalked.index.key(READER));
  });

  it("forgets the kept closure with its test file", async () => {
    const keys = await started();
    await resolve(keys, WALKED);
    keys.removeTestFile(READER);
    expect(keys.keptClosure(READER)).toBeUndefined();
  });
});
