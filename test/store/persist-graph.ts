import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blobHash } from "../../src/core/hash/blob.js";
import { environmentHash } from "../../src/core/keys/environment-hash.js";
import { type FetchedPart, recordImportGraph } from "../../src/core/store/import-edges.js";
import type { CoreEnvironmentInputs } from "../../src/core/types/keys.js";
import type { RunnerEnvironment } from "../../src/core/types/runner.js";
import type { Store } from "../../src/core/types/store.js";
import { worktree } from "./helpers.js";

/*
 * Rows 015-108 and 015-109, R1: a real adapter's closures and environments
 * persisted as a daemon's runner part does: each file's stat and blob id
 * in `file_hashes`, each environment under its real hash
 * (`environmentHash`), then `recordImportGraph`.
 */

const CORE: CoreEnvironmentInputs = {
  squealVersion: "0.0.0",
  nodeVersion: "v24.0.0",
  platform: "linux",
  arch: "x64",
  installedDependencies: "deps",
  env: {},
};

/** The blob id of `path` under `root` now; `null` with no file. */
const blobOf = (root: string, path: string) =>
  existsSync(join(root, path)) ? blobHash(readFileSync(join(root, path)), "sha1") : null;

/** Persists `fetched` for the worktree `id` at `root`; returns each project's environment hash. */
export function persistGraph(
  store: Store,
  id: string,
  root: string,
  fetched: FetchedPart & { readonly environments: readonly RunnerEnvironment[] },
): Map<string, string> {
  store.worktrees.upsert(worktree(id, root));
  const paths = new Set<string>();
  for (const env of fetched.environments) for (const path of env.files) paths.add(path);
  for (const closure of fetched.closures ?? []) {
    for (const path of closure.paths) paths.add(path);
    for (const file of closure.imports ?? []) paths.add(file.path);
  }
  const hashes = new Map<string, string>();
  for (const path of paths) {
    const blob = blobOf(root, path);
    if (blob === null) continue;
    hashes.set(path, blob);
    const s = lstatSync(join(root, path));
    store.fileHashes.upsertMany(id, [
      { path, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, size: s.size, inode: s.ino, hash: blob },
    ]);
  }
  const hashOf = (path: string) => (paths.has(path) ? (hashes.get(path) ?? null) : undefined);
  const environments = new Map(
    fetched.environments.map((env) => [env.project, environmentHash(CORE, env, hashOf)]),
  );
  recordImportGraph(
    {
      store,
      root,
      worktreeId: id,
      now: () => 1_000,
      keys: {
        cache: { hashOf },
        index: { environment: (project) => environments.get(project) },
        environmentFiles: (project) =>
          fetched.environments.find((env) => env.project === project)?.files ?? [],
      },
    },
    fetched,
  );
  return environments;
}
