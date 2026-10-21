import { join } from "node:path";
import { loadPolicy } from "../../../../src/core/daemon/policy.js";
import { readHead } from "../../../../src/core/daemon-loop/head.js";
import { createFsHasher } from "../../../../src/core/hash/index.js";
import { WorktreeKeys } from "../../../../src/core/scheduler/keying.js";
import type {
  CheckKey,
  RunnerEnvironment,
  TestFileRef,
  WorktreeId,
} from "../../../../src/core/types/index.js";
import { git, scratchStore, writeTree } from "./shared.js";

/*
 * A test file keyed over an install as a daemon keys it (task 011-85 R4):
 * the tree's `WorktreeKeys` reads the installed lockfile and the runner's
 * environment, whose packages are scoped, and the file's closure imports
 * `child_process`, so its segment is the whole fingerprint.
 */

const ENVIRONMENT: RunnerEnvironment = {
  project: "",
  runnerName: "validity",
  runnerVersion: "1",
  adapterVersion: "1",
  resolvedConfig: "{}",
  files: [],
  packages: { imports: [], builtins: [] },
};

export interface Keyed {
  readonly key: CheckKey;
  readonly keys: WorktreeKeys;
  close(): void;
}

/** `testFile`'s key in a fixture worktree at `root` with `installed` written after the commit. */
export async function keyedOver(
  testFile: TestFileRef,
  installed: Readonly<Record<string, string>>,
  root: string,
): Promise<Keyed> {
  writeTree(root, { ".gitignore": "node_modules/\n", [testFile.path]: "// a test\n" });
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "fixture"]);
  writeTree(root, installed);
  const store = scratchStore(join(root, ".git"));
  try {
    const keys = new WorktreeKeys({
      root,
      worktreeId: "validity-keyed" as WorktreeId,
      store,
      hasher: createFsHasher(root, "sha1"),
      objectFormat: "sha1",
      policy: loadPolicy(root).policy,
      squealVersion: "0.0.0-validity",
      env: {},
      onExtraFiles: () => {},
    });
    await keys.bootstrap(() => readHead(root));
    await keys.setEnvironments([ENVIRONMENT]);
    const packages = { imports: [], builtins: ["child_process"] };
    keys.setClosure({ testFile, paths: [testFile.path], packages });
    const key = keys.index.key(testFile);
    if (key === null) throw new Error(`${testFile.path} has no key`);
    return { key, keys, close: () => store.close() };
  } catch (error) {
    store.close();
    throw error;
  }
}
