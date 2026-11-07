import { type FetchedPart, recordImportGraph } from "../../src/core/store/import-edges.js";
import type { RunnerEnvironment } from "../../src/core/types/runner.js";
import type { Store } from "../../src/core/types/store.js";
import { worktree } from "./helpers.js";
import { type Keyed, keyed } from "./test-key.js";

/*
 * Rows 015-108 and 015-109, R2: a real adapter's closures and environments
 * persisted as a daemon's runner part does: keyed by the real key code,
 * each test file's key stored as the worktree's current key, then
 * `recordImportGraph` with those keys.
 */

/** Persists `fetched` for the worktree `id` at `root`; returns its key index. */
export async function persistGraph(
  store: Store,
  id: string,
  root: string,
  fetched: FetchedPart & { readonly environments: readonly RunnerEnvironment[] },
): Promise<Keyed> {
  store.worktrees.upsert(worktree(id, root));
  const closures = fetched.closures ?? [];
  const keys = await keyed(root, fetched.environments, closures);
  store.testFileKeys.upsertMany(
    closures.map((c) => ({
      worktreeId: id,
      testFile: c.testFile,
      key: keys.index.key(c.testFile),
      revision: 1,
      pending: null,
    })),
  );
  recordImportGraph(
    {
      store,
      now: () => 1_000,
      keys: {
        index: keys.index,
        environmentFiles: (project) =>
          fetched.environments.find((env) => env.project === project)?.files ?? [],
      },
    },
    fetched,
  );
  return keys;
}
