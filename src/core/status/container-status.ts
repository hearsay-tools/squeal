import { compare } from "../fs/compare.js";
import type { WorktreeId } from "../types/common.js";
import type { StatusSnapshot } from "../types/status.js";
import { type Store, worktreeMetaKey } from "../types/store.js";

/*
 * Spec 027 D7.3 (row 027-06): each container target's state and key mode
 * in plain `squeal status`, as `Containers: container backend (ready,
 * build-content)`. The daemon keeps the line in a `meta` row of its own,
 * as the remote's summary (`remote-status.ts`, review 0.1.623 B2), so no
 * later note evicts it; an empty line removes the row.
 */

/** One project's target state, as the daemon learns it. */
export interface ContainerStateEntry {
  readonly target: string;
  readonly project: string;
  readonly runner: string;
  readonly state: string;
  readonly keyMode: string;
}

function containerSummaryMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("containerSummary", worktreeId);
}

/** The daemon's container summary line of `worktreeId`; `undefined` when it has none. */
export function readContainerSummary(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
): string | undefined {
  const text = store.meta.get(containerSummaryMetaKey(worktreeId));
  return text === null || text === "" ? undefined : text;
}

/** Keeps `text` as `worktreeId`'s container summary line; an empty `text` removes it. */
export function writeContainerSummary(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
  text: string,
): void {
  const key = containerSummaryMetaKey(worktreeId);
  if (text === "") store.meta.delete(key);
  else store.meta.set(key, text);
}

/**
 * The summary of `entries`, one part per target sorted by name: its
 * projects' states (several when they differ) and its key mode.
 */
export function containerSummaryText(entries: readonly ContainerStateEntry[]): string {
  const targets = new Map<string, { states: Set<string>; keyMode: string }>();
  for (const entry of entries) {
    const seen = targets.get(entry.target) ?? { states: new Set(), keyMode: entry.keyMode };
    seen.states.add(entry.state);
    targets.set(entry.target, seen);
  }
  return [...targets]
    .sort(([a], [b]) => compare(a, b))
    .map(([target, { states, keyMode }]) => {
      const state = [...states].sort(compare).join("/");
      return `container ${target} (${state}, ${keyMode})`;
    })
    .join("; ");
}

/** A configured container project, as the policy declares it now. */
export interface ActiveContainerProject {
  readonly runner: string;
  readonly project: string;
  readonly target: string;
}

/**
 * The daemon's live set of entries by runner and project. `set` returns
 * the summary text when it changed, else `null`. `reconcile` drops each
 * entry whose project is no longer configured, or now names another
 * target (review 0.1.644 N1), and returns the new text when it changed:
 * `""` once no entry is left, which removes the status row.
 */
export function containerSummaries(): {
  set(entry: ContainerStateEntry): string | null;
  reconcile(active: readonly ActiveContainerProject[]): string | null;
} {
  const entries = new Map<string, ContainerStateEntry>();
  const keyOf = (e: { runner: string; project: string }) => `${e.runner}\0${e.project}`;
  let last = "";
  const changed = (): string | null => {
    const text = containerSummaryText([...entries.values()]);
    if (text === last) return null;
    last = text;
    return text;
  };
  return {
    set(entry) {
      entries.set(keyOf(entry), entry);
      return changed();
    },
    reconcile(active) {
      const targets = new Map(active.map((a) => [keyOf(a), a.target]));
      for (const [key, entry] of entries) {
        if (targets.get(key) !== entry.target) entries.delete(key);
      }
      return changed();
    },
  };
}

/** The snapshot's `containers` field: the daemon's summary line, when it has one. */
export function containersOf(
  store: Pick<Store, "meta">,
  worktreeId: WorktreeId,
): { containers?: string } {
  const text = readContainerSummary(store, worktreeId);
  return text === undefined ? {} : { containers: text };
}

/** `Containers: <line>` while a container target is configured and seen. */
export function containerLines(s: Pick<StatusSnapshot, "containers">): string[] {
  return s.containers === undefined ? [] : [`Containers: ${s.containers}`];
}
