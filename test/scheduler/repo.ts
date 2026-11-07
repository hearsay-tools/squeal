import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import { git } from "../hash/git-repo.js";
import { keptByTrace, onCleanUp } from "./cleanup.js";

const fixtures = resolve(import.meta.dirname, "../fixtures/scheduler");
/** Inside the repository, so fixture copies resolve `vitest` from its `node_modules`. Git-ignored. */
const scratchDir = resolve(import.meta.dirname, "../fixtures/scheduler/.tmp");

export const ALL_TEST_FILES = [
  "test/gen.test.ts",
  "test/math.test.ts",
  "test/plain.test.ts",
  "test/strings.test.ts",
  "test/upper.test.ts",
];

export const ref = (path: string): TestFileRef => ({ project: "", path });

/**
 * A git repository holding a copy of a fixture under `test/fixtures/scheduler`.
 * In `basic`, `src/gen/` is gitignored but present.
 */
export function createRepo(fixture: "basic" | "barrel" | "barrel-only" | "observed" = "basic"): {
  main: string;
  commonDir: string;
  dir: string;
} {
  mkdirSync(scratchDir, { recursive: true });
  const dir = join(scratchDir, randomUUID());
  const main = join(dir, "main");
  cpSync(join(fixtures, fixture), main, { recursive: true });
  renameSync(join(main, "_gitignore"), join(main, ".gitignore"));
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["add", "-A"]);
  git(main, ["commit", "-qm", "fixture"]);
  onCleanUp(() => {
    if (!keptByTrace(dir)) rmSync(dir, { recursive: true, force: true });
  });
  return { main: realpathSync(main), commonDir: realpathSync(join(main, ".git")), dir };
}

/** `git worktree add` of `main` at `dir/name`, with the generated file codegen would write. */
export function addWorktree(main: string, dir: string, name: string): string {
  const root = join(dir, name);
  git(main, ["worktree", "add", "-q", "-b", name, root]);
  cpSync(join(main, "src/gen"), join(root, "src/gen"), { recursive: true });
  return realpathSync(root);
}

export function openRepoStore(commonDir: string): Store {
  const store = openStore(commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  onCleanUp(() => store.close());
  return store;
}
