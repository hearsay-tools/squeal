import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { classLines, fileEntry, reasonGroups } from "../../src/cli/named-file-lines.js";
import { readNamedFiles } from "../../src/cli/named-files.js";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import { daemonLiveness } from "../../src/core/delivery/index.js";
import { type RecordedCause, recordUnknownFiles } from "../../src/core/scheduler/unknown-files.js";
import type { LoadNow } from "../../src/core/status/next-step.js";
import type {
  CheckKey,
  EpochMs,
  RevisionNumber,
  Store,
  WorktreeId,
} from "../../src/core/types/index.js";
import { NOW, ref } from "./status-wait-fixture.js";

/*
 * Row 011-27: a seeded store read as a named wait reads it, for one test per
 * row of design 011-24 section 3's table (`next-step-rows.test.ts`,
 * `next-step-pending.test.ts`).
 */

export const QUIET: LoadNow = { oneMinute: 7.45, cpus: 24 };
export const BUSY: LoadNow = { oneMinute: 30.2, cpus: 24 };

/** The worktree's daemon at `NOW`, as `readNamedFiles` takes it. */
function liveness(store: Store, worktreeId: WorktreeId) {
  return daemonLiveness(store.worktrees.get(worktreeId)?.daemon ?? null, NOW as EpochMs);
}

/** `paths` read as a named wait's end reads them: the class blocks, the verdict line's groups, the JSON entries. */
export function named(
  store: Store,
  worktreeId: WorktreeId,
  root: string,
  paths: readonly string[],
  load: LoadNow = QUIET,
) {
  const files = readNamedFiles(
    store,
    worktreeId,
    root as never,
    paths.map(ref),
    liveness(store, worktreeId),
    NOW as EpochMs,
    () => load,
  );
  return {
    files,
    lines: classLines(files, "squeal"),
    groups: reasonGroups(files, "squeal"),
    entries: files.map((f) => fileEntry(f, "squeal")),
  };
}

/** The key `key()` of the fixture writes for a file with no work. */
export const doneKey = (path: string) => `key-${path}-done` as CheckKey;

/** `path` marked `unknown` at its done key, as the scheduler records it. */
export function marked(
  store: Store,
  worktreeId: WorktreeId,
  path: string,
  reason: string,
  options: {
    readonly ran?: boolean;
    readonly cause?: RecordedCause;
    readonly key?: CheckKey | null;
  } = {},
) {
  store.transaction(() =>
    recordUnknownFiles(
      store,
      worktreeId,
      [
        {
          testFile: ref(path),
          key: options.key === undefined ? doneKey(path) : options.key,
          reason,
          ran: options.ran ?? false,
          samples: [],
          revision: 4 as RevisionNumber,
          at: NOW as EpochMs,
          ...(options.cause === undefined ? {} : { cause: options.cause }),
        },
      ],
      () => true,
    ),
  );
}

export function config(root: string, value: unknown) {
  writeFileSync(join(root, "squeal.config.json"), JSON.stringify(value));
}

const synced = (): SyncState => ({
  state: "synced",
  revision: 4 as RevisionNumber,
  incarnation: null,
});

/** A named wait from `cwd` whose daemon's pass is at revision 4, ended by its deadline. */
export async function waited(cwd: string, paths: readonly string[], timeoutMs = 60) {
  const wait = await waitForNamed(cwd, paths, {
    timeoutMs,
    pollMs: 20,
    settleMs: 0,
    now: () => NOW,
    sync: (): DaemonSync => ({ current: synced, stop: () => {} }),
    // Row 011-207's ask is `status-wait-ask.test.ts`'s: these rows are a file's that the wait
    // asks nothing of, as after its one run at the key ended, or a source path's selection.
    ask: async () => [],
  });
  if (wait.outcome === "unavailable") throw new Error("unavailable");
  return { wait, lines: namedText(wait, NOW).trimEnd().split("\n") };
}
