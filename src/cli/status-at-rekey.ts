import { resultsAt, withStores } from "../core/commit/at-keys-checkout.js";
import { squealVersion } from "../core/daemon/version.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath, RelativePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { Store } from "../core/types/store.js";
import { daemonAdapters } from "./code-gate-stored.js";
import type { AtOptions } from "./status-at.js";
import { idOf } from "./status-at-after.js";
import { commitSide } from "./status-at-commit.js";
import type { SideQueue } from "./status-at-queue.js";
import type { SideState } from "./status-at-report.js";

/*
 * Review wave-23 B3 (spec 023 D7.1, D2): a file's first run can observe
 * inputs its key did not cover yet, and the commit daemon then stores its
 * result at the key those inputs give. The call keyed before the run, so
 * after the wait it keys the files whose daemon holds a result at another
 * key once more, by D2 (the gate's keyer in a temporary checkout at the
 * commit, reading the observed set as it is now), with the same checks of
 * the commit's tree and of the install. The report reads each file at that
 * key (`commitAfter`, with its origin): the daemon's result when the two
 * keys agree, and the refusal to mix keys (`reasonOf`) when they still
 * differ. A file the checkout no longer keys reads as that checkout says.
 */

export interface RekeyInput {
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly commit: string;
  readonly env: NodeJS.ProcessEnv;
  readonly note: (text: string) => void;
  readonly options: Pick<AtOptions, "cacheRoot" | "install">;
}

/**
 * The commit side's states after the wait's runs: `keyed` with the files
 * of `queue` whose key grew keyed again; `keyed` itself when none did.
 */
export async function rekeyGrown(
  input: RekeyInput,
  keyed: (ref: TestFileRef) => SideState,
  queue: SideQueue,
): Promise<(ref: TestFileRef) => SideState> {
  const grown = await withStores(input.commonDir, async (main) =>
    main === null ? [] : grownKeys(main, keyed, queue),
  );
  if (grown.length === 0) return keyed;
  const paths = [...new Set(grown.map((ref) => ref.path))] as RelativePath[];
  const again = await commitSide({
    adapters: daemonAdapters,
    squealVersion: squealVersion(),
    env: input.env,
    ...input.options,
    root: input.root,
    commit: input.commit,
    paths,
    worktreeId: input.worktreeId,
    note: input.note,
  });
  const ids = new Set(grown.map(testFileId));
  return (ref) => (ids.has(testFileId(ref)) ? keyOnly(again.state(ref)) : keyed(ref));
}

/** A keyed state as the call's keying gives it, read after the wait (`commitAfter`): its key alone. */
function keyOnly(state: SideState): SideState {
  return state.state === "pass" || state.state === "fail"
    ? { state: "no result", key: state.key }
    : state;
}

/** The files of `queue` with no result at the call's key that its daemon stored a result of at another. */
export function grownKeys(
  main: Store,
  keyed: (ref: TestFileRef) => SideState,
  queue: SideQueue,
): TestFileRef[] {
  if (queue.root === null || queue.files.length === 0) return [];
  const tree = idOf(queue.root);
  const rows = new Map(main.testFileKeys.list(tree).map((row) => [testFileId(row.testFile), row]));
  return queue.files.filter((ref) => {
    const before = keyed(ref);
    if (before.state !== "no result") return false;
    const key = rows.get(testFileId(ref))?.key ?? null;
    if (key === null || key === before.key) return false;
    return resultsAt(main, ref, key).some((record) => record.provenance.worktreeId === tree);
  });
}
