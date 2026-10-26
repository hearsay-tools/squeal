import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import { ReverseIndex } from "../../src/core/keys/reverse-index.js";
import type {
  CheckKey,
  RelativePath,
  RevisionNumber,
  Store,
  TestFileRef,
} from "../../src/core/types/index.js";
import { NOW, ref } from "./status-wait-fixture.js";

/*
 * Row 011-234 (`research/source-path-selection.md`, finding 1): two
 * worktrees, W (the wait's) and X (another worker's), share one store, and
 * so one closure record per test file. 13 test files read `START`: five
 * through `HELPER`, eight at run time; 20 others read only `TYPES`.
 */

export const START = "src/cli/start.ts";
export const HELPER = "test/daemon/start-helpers.ts";
export const TYPES = "src/core/types/index.ts";
export const SPAWNED = "test/daemon/start-spawned.test.ts";

/** The five files that import `startCommand` through `start-helpers.ts`. */
export const HELPER_READERS = ["endpoint", "handoff", "register", "short", "spawned"].map(
  (n) => `test/daemon/start-${n}.test.ts`,
);
/** The eight files that read `start.ts` at run time (observed reads). */
export const RUNTIME_READERS = [
  "test/daemon/bootstrapped.test.ts",
  "test/daemon/scratch-refused.test.ts",
  "test/daemon/user-config-note.test.ts",
  "test/daemon/drain-checkpoint.test.ts",
  "test/daemon/scratch.test.ts",
  "test/daemon/stop-cancel.test.ts",
  "test/harness/opencode-abort.test.ts",
  "test/integration/pi-silence.test.ts",
];
export const READERS = [...HELPER_READERS, ...RUNTIME_READERS];
export const OTHERS = Array.from({ length: 20 }, (_, i) => `test/core/other-${i}.test.ts`);
export const ALL = [...READERS, ...OTHERS];

/** `path`'s closure beside itself, in every worktree: their content differs, not their imports. */
function closureOf(path: string): string[] {
  if (HELPER_READERS.includes(path)) return [HELPER, START, TYPES];
  if (RUNTIME_READERS.includes(path)) return [START, TYPES];
  return [TYPES];
}

/** `storeClosures`'s write: the one record of each of `files`, by `by`. */
export function storeClosures(store: Store, files: readonly string[], by: string) {
  for (const path of files) {
    store.testFiles.put({
      testFile: ref(path),
      closure: {
        testFile: ref(path),
        paths: [path, ...closureOf(path)].sort() as never,
        complete: false,
        method: CLOSURE_METHOD,
      },
      updatedAt: NOW,
      updatedBy: by,
    });
  }
}

/** `worktree`'s keys of `files` at `tag`, as a content re-key writes them. */
export function keys(store: Store, worktree: string, files: readonly string[], tag: string) {
  store.testFileKeys.upsertMany(
    files.map((path) => ({
      worktreeId: worktree,
      testFile: ref(path),
      key: `${tag}-${path}` as CheckKey,
      revision: 4 as RevisionNumber,
      pending: null,
    })),
  );
}

/**
 * The daemon's answer for `paths` (`SyncAnswer.readers`): W's own key
 * index, which holds every file's closure whatever the store's records say.
 */
export function daemonReaders(
  paths: readonly RelativePath[],
): ReadonlyMap<RelativePath, readonly TestFileRef[]> {
  const index = new ReverseIndex();
  for (const path of ALL) index.set(ref(path), [path, ...closureOf(path)]);
  return new Map(paths.map((path) => [path, index.referencing([path])]));
}

/** A daemon synced at revision 4 that answers `daemonReaders` of the paths it is asked; counts the asks. */
export function answeringReaders(withReaders = true) {
  const asked: (readonly RelativePath[])[] = [];
  const sync = (_root: string, _pollMs: number, paths: readonly RelativePath[]): DaemonSync => {
    asked.push(paths);
    const state: SyncState = {
      state: "synced",
      revision: 4 as RevisionNumber,
      incarnation: null,
      ...(withReaders ? { readers: daemonReaders(paths) } : {}),
    };
    return { current: () => state, stop: () => {} };
  };
  return { asked, sync };
}
