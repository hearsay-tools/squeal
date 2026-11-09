import { testFileId } from "../keys/reverse-index.js";
import type { WorktreeKeys } from "../scheduler/keying.js";
import { Lockfiles } from "../scheduler/lockfiles.js";
import { RefusedObserved } from "../scheduler/refused-observed.js";
import type { KeyParts } from "../store/transfer-bundle.js";
import type { AbsolutePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { RunnerClosure, RunnerEnvironment } from "../types/runner.js";

/*
 * Spec 018 D11 (2026-11-09): each exported file's `keyParts`, the two
 * segments of its key a store does not keep, so an import can prove the
 * exported key and re-key the file. Read from the same objects
 * `WorktreeKeys.setClosure` keys the file with, in the same way: the
 * installed-dependency segment of the runner's packages (`Lockfiles`,
 * `DependencyKeys.of`) and the runtime segment with the refused observed
 * paths (`RefusedObserved.keyed`). Kept outside the keying code so the
 * key-format alarm sees no change; a wrong segment cannot re-key a file,
 * since the import's proof recomputes the exported key with it.
 */

/** Each keyed file's `keyParts` at the keys `keys` holds now; `null` for a file it has no closure of. */
export async function keyPartsOf(
  input: { readonly root: AbsolutePath },
  keys: WorktreeKeys,
  environments: readonly RunnerEnvironment[],
  closures: ReadonlyMap<string, RunnerClosure>,
): Promise<(file: TestFileRef) => KeyParts | null> {
  const dependencies = await new Lockfiles(input.root).set(environments);
  const refused = new RefusedObserved(
    () => {},
    () => false,
  );
  return (file) => {
    const ref = { project: file.project, path: file.path };
    const closure = closures.get(testFileId(ref));
    if (closure === undefined) return null;
    const raw = keys.observes(ref.project) ? keys.observedOf(ref) : [];
    return {
      dependencies: dependencies.get(ref.project)?.of(closure.packages) ?? "",
      runtime: refused.keyed(ref, raw, keys.runtimeIdentity(ref)),
    };
  };
}
