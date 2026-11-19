import { readPolicy } from "../core/daemon/policy.js";
import { worktreeIdFor } from "../core/fs/git-layout.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { groupView } from "../core/scheduler/slow.js";
import { testFileKeyOf } from "../core/state/derive.js";
import { fileClassOf } from "../core/state/file-class.js";
import { CLI_READ_RETRY_MS, withStatusStore } from "../core/status/open.js";
import { readTransaction } from "../core/store/store.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { KnownState } from "../core/types/state.js";
import type { Store } from "../core/types/store.js";
import { notCovered } from "../harness/shared/not-covered.js";
import { runnerCoverage } from "../runners/descriptions.js";
import { type CheckResults, checksText, type StoreView } from "./checks-text.js";
import { worktreeRoot } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { statusCommand } from "./status-command.js";

/**
 * Row 005-126: `squeal checks`, the checks this repository defines and when
 * each runs (`checksText`). Read-only and with no daemon: the policy from
 * `squeal.config.json`, and, where a store is, each test check's listed
 * files and last results through the read `squeal status` uses. Exit 0, 1
 * outside a git worktree, 2 on an argument.
 */
export function checksCommand(args: readonly string[], io: CliIo): number {
  if (args.length > 0) {
    io.stderr(`squeal checks: unknown argument "${args[0]}"\nUsage: squeal checks\n`);
    return 2;
  }
  const root = worktreeRoot(undefined, io);
  if (root === null) return 1;
  const policy = readPolicy(root);
  const view = groupView(policy);
  const read = withStatusStore(root, { busyRetryMs: CLI_READ_RETRY_MS }, ({ store }) =>
    readTransaction(store, () => storeView(store, root, view)),
  );
  const store = read === null || "available" in read ? null : read;
  // What Squeal does not run, for this repository's runners.
  const left = notCovered(runnerCoverage(policy, root));
  io.stdout(checksText(policy, view.groups, store, statusCommand(io.env ?? process.env), left));
  return 0;
}

/** Each test check's files in the daemon's last listing and their last results. */
function storeView(
  store: Store,
  root: AbsolutePath,
  view: ReturnType<typeof groupView>,
): StoreView | null {
  const worktreeId = worktreeIdFor(root);
  if (store.worktrees.get(worktreeId) === null) return null;
  const own = new Map<string, KnownState[]>();
  for (const state of store.knownStates.list(worktreeId)) {
    if (state.check.kind === "setup") continue;
    const id = testFileKeyOf(state.check);
    own.set(id, [...(own.get(id) ?? []), state]);
  }
  const counts = new Map<
    string,
    { files: number; pass: number; fail: number; notCurrent: number }
  >();
  for (const group of view.groups) {
    if (group.select.kind !== "lint")
      counts.set(group.name, { files: 0, pass: 0, fail: 0, notCurrent: 0 });
  }
  for (const row of store.testFileKeys.list(worktreeId)) {
    const count = counts.get(view.of(row.testFile).name);
    if (count === undefined) continue;
    const states = own.get(testFileId(row.testFile)) ?? [];
    count.files += 1;
    if (fileClassOf(row, states) !== "current") count.notCurrent += 1;
    else if (states.some((state) => state.outcome === "fail")) count.fail += 1;
    else count.pass += 1;
  }
  const results: ReadonlyMap<string, CheckResults> = counts;
  return { revision: store.revisions.latest(worktreeId)?.number ?? null, results };
}
