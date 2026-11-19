import { commonDirOf, withStores } from "../core/commit/at-keys-checkout.js";
import { observedModulesMetaKey } from "../core/keys/modules.js";
import {
  observedDirectMetaKey,
  observedMetaKey,
  readSharedEntries,
} from "../core/keys/observed.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { observedStartupMetaKey } from "../core/keys/startup.js";
import { type UnnamedInputs, unnamedInputs } from "../core/proof/inputs.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { Store } from "../core/types/store.js";

/*
 * Spec 023 D5.2 (row 023-21, `reviews/wave-14-fifth.md` 2): after the
 * sides of an unchanged named test ran, what it read, as Squeal keeps it
 * for keys: the keyed closure and the repository's shared observed rows,
 * which every kept run merges (`gate/keep-seen.ts` `mergeSeen`): the
 * paths its runs read, the modules they loaded, the direct marks, and its
 * project's start-up paths. Read from the main store; nothing is written.
 */

export interface InputsInput {
  readonly root: AbsolutePath;
  /** The unchanged named files that ran or were read. */
  readonly refs: readonly TestFileRef[];
  readonly loadsOf: (ref: TestFileRef) => readonly RelativePath[];
  readonly changed: ReadonlySet<RelativePath>;
  /** Named files, `--with` and `--source` paths. */
  readonly settled: ReadonlySet<RelativePath>;
  /** Why the sides' reads were not recorded (a forced run); `null` when they were. */
  readonly unrecorded: string | null;
}

/** Each of `refs` with changed inputs the call did not name, by `testFileId`. */
export async function unnamedOf(input: InputsInput): Promise<Map<string, UnnamedInputs>> {
  const out = new Map<string, UnnamedInputs>();
  if (input.refs.length === 0) return out;
  await withStores(commonDirOf(input.root), async (main) => {
    for (const ref of input.refs) {
      const inputs =
        input.unrecorded !== null || main === null
          ? null
          : [...input.loadsOf(ref), ...observedOf(main, ref)];
      const why = input.unrecorded ?? "no store holds the runs' reads";
      const unnamed = unnamedInputs(inputs, input.changed, input.settled, why);
      if (unnamed !== null) out.set(testFileId(ref), unnamed);
    }
  });
  return out;
}

/** The shared observed rows of `ref`: its reads, module loads and direct marks, and its project's start-up. */
function observedOf(main: Store, ref: TestFileRef): RelativePath[] {
  const rows = [observedMetaKey, observedModulesMetaKey, observedDirectMetaKey].flatMap(
    (key) => readSharedEntries(main, key(ref.project))[ref.path] ?? [],
  );
  const startup = readSharedEntries(main, observedStartupMetaKey(ref.project), "list")[""] ?? [];
  return [...rows, ...startup];
}
