import { compare, isRecord } from "../fs/index.js";
import type { ProjectName, RunnerAdapter } from "../types/index.js";

/** What one reconcile changed (`RunnerSet.reconcile`). */
export interface Reconciled {
  /** Runners of projects the configuration no longer has: a part of theirs in flight stops. */
  readonly removed: readonly RunnerAdapter[];
  /** Runners of projects whose entry changed: replaced, a part of theirs in flight finishes. */
  readonly replaced: readonly RunnerAdapter[];
  /** Every project removed, added or replaced, sorted. */
  readonly projects: readonly ProjectName[];
}

/**
 * The runners of one kind of configured project, one per entry (spec 003
 * D7), read from the live configuration (011 C10, *Projects at a reload*,
 * row 011-78). The composite runner reconciles each set before its
 * `invalidate` fans out.
 */
export interface RunnerSet<R extends RunnerAdapter = RunnerAdapter> {
  /** The runners of the entries as of the last reconcile, in entry order. */
  members(): readonly R[];
  /**
   * Compares each entry with the one its runner was built from, by name and
   * over every field: a new name is built, a changed entry is built again,
   * and a name the entries no longer have leaves. A rename is both.
   */
  reconcile(): Reconciled;
}

/** A set over `entries`, read at each reconcile; `build` makes one entry's runner. */
export function createRunnerSet<P extends { readonly name: ProjectName }, R extends RunnerAdapter>(
  entries: () => readonly P[],
  build: (entry: P) => R,
): RunnerSet<R> {
  const make = (entry: P) => ({ runner: build(entry), stamp: stampOf(entry) });
  let built = new Map(entries().map((entry) => [entry.name, make(entry)]));
  return {
    members: () => [...built.values()].map((member) => member.runner),
    reconcile() {
      const next = new Map<ProjectName, { runner: R; stamp: string }>();
      const replaced: R[] = [];
      const projects = new Set<ProjectName>();
      for (const entry of entries()) {
        const was = built.get(entry.name);
        if (was !== undefined && was.stamp === stampOf(entry)) {
          next.set(entry.name, was);
          continue;
        }
        next.set(entry.name, make(entry));
        projects.add(entry.name);
        if (was !== undefined) replaced.push(was.runner);
      }
      const removed = [...built].filter(([name]) => !next.has(name));
      for (const [name] of removed) projects.add(name);
      built = next;
      return {
        removed: removed.map(([, member]) => member.runner),
        replaced,
        projects: [...projects].sort(compare),
      };
    },
  };
}

/** An entry as canonical JSON: object keys sorted, so a reordered entry is the same entry. */
function stampOf(entry: unknown): string {
  return JSON.stringify(entry, (_, value: unknown) =>
    isRecord(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => compare(a, b)))
      : value,
  );
}
