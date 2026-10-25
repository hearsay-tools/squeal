import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { WorktreePaths } from "../../../../src/core/fs/worktree-paths.js";
import { listingPath, ObservedSets, observedMetaKey } from "../../../../src/core/keys/index.js";
import {
  OBSERVE_VARIABLE,
  observedInputs,
  observeEnv,
  takeRecorded,
} from "../../../../src/runners/observe/index.js";
import type { CaseOutput, ObserveInput } from "../case.js";
import { scratchStore, writeTree } from "./shared.js";

/**
 * The observed set a run keeps (011 C3, C12): the tree's recorder in a child
 * Node that runs `input.script` in a fixture worktree, its observations read
 * and kept in a store's `meta` by the tree's code. The read paths and the
 * listings join the set as `observedGrowth` adds them for a file with an
 * empty closure in a worktree that ignores nothing. With `temporary`, each
 * directory the script printed stands as `<temporary N>`, so a random name
 * is the same at both trees.
 */
export function observe(input: ObserveInput, scratch: string, runtime: string): CaseOutput {
  const root = writeTree(join(scratch, "worktree"), input.files);
  const out = join(scratch, "observed");
  mkdirSync(out, { recursive: true });
  const testFile = { project: "", path: input.testFile };
  const env = observeEnv(join(runtime, "recorder.cjs"), { out, root, skip: [] }, undefined);
  const settings = JSON.parse(env[OBSERVE_VARIABLE] ?? "{}") as Record<string, unknown>;
  const child = spawnSync(process.execPath, ["-e", input.script], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      [OBSERVE_VARIABLE]: JSON.stringify({ ...settings, file: join(root, input.testFile) }),
    },
  });
  if (child.status !== 0) throw new Error(`the observed script failed: ${child.stderr}`);
  const observed = observedInputs(takeRecorded(out), [testFile], new WorktreePaths(root));
  const store = scratchStore(join(scratch, "store"));
  try {
    const sets = new ObservedSets(store);
    for (const o of observed) {
      const listed = [...o.directories, ...(o.recursive ?? [])].map(listingPath);
      sets.add(o.testFile, [...o.paths, ...listed]);
    }
    const outputs = { observed, kept: store.meta.get(observedMetaKey(testFile.project)) };
    return { outputs: input.temporary === true ? named(outputs, child.stdout) : outputs };
  } finally {
    store.close();
  }
}

/** `outputs` with each directory `printed` names, one per line, as `<temporary N>`. */
function named(outputs: unknown, printed: string): unknown {
  const dirs = printed.split("\n").filter((line) => line !== "");
  const text = dirs.reduce(
    (out, dir, i) => out.replaceAll(dir, `<temporary ${i + 1}>`),
    JSON.stringify(outputs),
  );
  return JSON.parse(text);
}
