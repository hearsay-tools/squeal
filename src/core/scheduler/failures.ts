import type { ProjectName, RelativePath, TestFileRef } from "../types/index.js";
import type { FileState } from "./files.js";
import type { Ledger, SettleOptions } from "./ledger.js";
import type { RecordedCause } from "./unknown-files.js";

/**
 * Failed runner calls of one revision, by project; `null` is every project.
 * Spec 001 D5: "when environment, invalidation or closure resolution fails
 * for a project, every test file of that project becomes `unknown`".
 */
export type Failures = Map<ProjectName | null, string>;

/** Records a failure; the first one of a project gives the reason. */
export function failed(failures: Failures, project: ProjectName | null, reason: string): void {
  if (!failures.has(project)) failures.set(project, reason);
}

/**
 * Blocks the files of failed projects; with no failure, settles the files a
 * previous one blocked, as the revision's own settle did (`options`: its
 * direct importers and whether it is catch-up, review wave 5, B2).
 */
export function settleFailures(
  ledger: Ledger,
  failures: Failures,
  retrying: boolean,
  changed: ReadonlySet<RelativePath>,
  options: SettleOptions = {},
): void {
  if (failures.size > 0) block(ledger, failures);
  else if (retrying) ledger.settle(unblock(ledger), changed, options);
}

/**
 * Spec 001 D5: "when environment, invalidation or closure resolution fails
 * for a project, every test file of that project becomes `unknown` at this
 * revision with the runner's message as the reason". A blocked file is not
 * queued until `unblock`; the next revision or `run --all` retries the runner
 * (`Ledger.broken`). `only` narrows the files blocked (task 001-382: those
 * a run that failed to start kept from running, whose `cause` is `setup`).
 * Returns the files blocked.
 */
export function block(
  ledger: Ledger,
  failures: Failures,
  only: (file: FileState) => boolean = () => true,
  cause: RecordedCause = "runner",
): FileState[] {
  const every = failures.get(null);
  const byReason = new Map<string, FileState[]>();
  for (const file of ledger.files.values()) {
    const reason = every ?? failures.get(file.ref.project);
    if (reason === undefined || file.blocked !== null || !only(file)) continue;
    file.blocked = reason;
    if (!ledger.queue.isForced(file.ref)) ledger.queue.remove(file.ref);
    const files = byReason.get(reason);
    if (files) files.push(file);
    else byReason.set(reason, [file]);
  }
  for (const [reason, files] of byReason) {
    ledger.markUnknown(
      files.map((file) => ({ file, key: file.key })),
      reason,
      { cause },
    );
  }
  ledger.broken = true;
  return [...byReason.values()].flat();
}

/** The runner works again: every blocked file is settled anew. Returns them. */
function unblock(ledger: Ledger): TestFileRef[] {
  const refs: TestFileRef[] = [];
  for (const file of ledger.files.values()) {
    if (file.blocked === null) continue;
    file.blocked = null;
    file.unknownKey = null;
    // Its known states are re-derived from the results under its key.
    ledger.touch(file);
    refs.push(file.ref);
  }
  ledger.broken = false;
  return refs;
}
