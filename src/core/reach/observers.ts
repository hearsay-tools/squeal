import { posix } from "node:path";
import { compare } from "../fs/compare.js";
import { plural } from "../text.js";
import type { RelativePath } from "../types/common.js";
import { isModulePath } from "./names.js";
import type { Pair, PathKind } from "./pairs.js";

/*
 * Spec 015 D11 as amended 2026-11-22 (row 015-128): the recorded facts
 * behind a `runtime read` or `child process` pair, which replace the
 * blanket "by design" note. A test file that re-runs on many source
 * modules outside its import walk reads broadly: it starts or bundles the
 * program from source (Squeal's `test/daemon/*`). Other observed pairs are
 * one path a test reads, such as `package.json`.
 */

/** A test file whose observed pairs hold at least this many modules outside its import walk reads broadly. */
export const BROAD_READS = 10;

export const OBSERVED_KINDS: ReadonlySet<PathKind> = new Set(["child process", "runtime read"]);

/** The module paths of `pairs` the test file re-runs on outside its import walk. */
export function outsideModules(pairs: readonly Pair[]): number {
  return pairs.filter((p) => OBSERVED_KINDS.has(p.kind) && isModulePath(p.path)).length;
}

/** Whether an observed pair is one of a broad reader's: a module of a test file that reads broadly. */
export function isBroadPair(pair: Pair, outside: number): boolean {
  return OBSERVED_KINDS.has(pair.kind) && outside >= BROAD_READS && isModulePath(pair.path);
}

/** How one file's observed pairs reach their test files. */
export interface Observers {
  /** Runtime reads of test files that do not read broadly: one path read in the test's own process. */
  inProcess: number;
  /** Loads in a process the test file started (`observedDirect.`). */
  child: number;
  /** Runtime reads of broad readers: each test file's path and its modules outside its import walk. */
  readonly broad: Map<RelativePath, number>;
}

export const noObservers = (): Observers => ({ inProcess: 0, child: 0, broad: new Map() });

export function addObserver(
  observers: Observers,
  pair: Pair,
  test: RelativePath,
  outside: number,
): void {
  if (pair.kind === "child process") observers.child++;
  else if (isBroadPair(pair, outside)) observers.broad.set(test, outside);
  else if (pair.kind === "runtime read") observers.inProcess++;
}

/** Each broad reader's group: `<dir>/*` when its folder holds several, else the test file. */
export function broadGroups(readers: Iterable<RelativePath>): ReadonlyMap<RelativePath, string> {
  const byFolder = new Map<string, RelativePath[]>();
  for (const test of readers) {
    const folder = posix.dirname(test);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), test]);
  }
  const out = new Map<RelativePath, string>();
  for (const [folder, tests] of byFolder) {
    for (const test of tests) out.set(test, tests.length > 1 ? `${folder}/*` : test);
  }
  return out;
}

/** `test/daemon/* (8, 40 to 140 modules each), test/e2e/a.test.ts (40 modules)`: the 3 largest groups. */
export function readerText(
  broad: ReadonlyMap<RelativePath, number>,
  groups: ReadonlyMap<RelativePath, string>,
): string {
  const byGroup = new Map<string, number[]>();
  for (const [test, modules] of broad) {
    const group = groups.get(test) ?? test;
    byGroup.set(group, [...(byGroup.get(group) ?? []), modules]);
  }
  const ranked = [...byGroup].sort((a, b) => b[1].length - a[1].length || compare(a[0], b[0]));
  const parts = ranked.slice(0, 3).map(([group, counts]) => {
    const low = Math.min(...counts);
    const high = Math.max(...counts);
    const modules = low === high ? plural(low, "module") : `${low} to ${high} modules each`;
    return counts.length === 1
      ? `${group} (${modules})`
      : `${group} (${counts.length}, ${modules})`;
  });
  const more = ranked.length > 3 ? ` and ${ranked.length - 3} more` : "";
  return `${parts.join(", ")}${more}`;
}

/**
 * The note of a file whose observed seconds outweigh its import seconds:
 * how many test files re-run on it outside their imports and how, and with
 * edits recorded, the share of the window's re-run seconds its edits re-ran.
 */
export function observedNote(
  path: string,
  observers: Observers,
  groups: ReadonlyMap<RelativePath, string>,
  editShare: number | null,
): string {
  const { inProcess, broad, child } = observers;
  const verb = (n: number, base: string) =>
    `${plural(n, "test file")} ${n === 1 ? `${base}s` : base}`;
  const parts = [
    ...(inProcess === 0
      ? []
      : [
          `${verb(inProcess, "read")} ${path} at run time in ${inProcess === 1 ? "its" : "their"} own process`,
        ]),
    ...(broad.size === 0
      ? []
      : [
          `${verb(broad.size, "read")} ${path} among many source modules, as tests that start or bundle the program from source do: ${readerText(broad, groups)}`,
        ]),
    ...(child === 0
      ? []
      : [
          `${verb(child, "load")} ${path} in a process ${child === 1 ? "it starts" : "they start"}`,
        ]),
  ];
  const total = inProcess + broad.size + child;
  const share =
    editShare === null
      ? ""
      : `; ${path === "these files" ? "their" : "its"} edits re-ran ${pctText(editShare)} of the window's re-run seconds`;
  const facts =
    parts.length === 1
      ? `${parts[0]}, outside ${total === 1 ? "its" : "their"} imports`
      : `${plural(total, "test file")} re-run on it outside their imports: ${parts.join("; ")}`;
  return `${facts}${share}`;
}

export const pctText = (share: number) =>
  share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`;
