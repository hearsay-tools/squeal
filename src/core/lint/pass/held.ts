import type { FileHash, RelativePath } from "../../types/index.js";
import { underModules } from "./keys.js";
import type { LintEnvironment, LintHeld, LintSnapshot } from "./provider.js";

/*
 * Wave 1.7, the human's "repair the cause" (review 0.1.351 B2-R3): every
 * byte ESLint used for a stored result is text the pass gave it or bytes
 * whose blob the worker reports, and the result's key holds that blob. The
 * pass keys with its own reads, the listing's blobs and the disk's for the
 * files outside it, and compares them with what the worker holds: before
 * any lookup (`disagreement`), and after each lint call (`spoiled`).
 */

/** A path's blob as this pass keys it; `null` when no file is there. */
export type KeyBlob = (path: RelativePath) => FileHash | null;

/** Whether every use the worker holds of a path is at `blob`. Unobserved bytes match none. */
export function heldAt(held: LintHeld | undefined, blob: FileHash | null): boolean {
  if (held === undefined) return true;
  if (held.unobserved === true) return false;
  const typescript = held.typescript === undefined || held.typescript === blob;
  return typescript && held.others.every((other) => other === blob);
}

/**
 * P3 (Q6): the paths the worker used that no key holds; they join every
 * key's closure, listed or not. A program file only TypeScript holds is
 * the whole-program keys', whose segment holds it. `segment` names the
 * listed files the segment holds, `null` while no key holds it.
 */
export function readClosure(
  snapshot: Pick<LintSnapshot, "closure" | "program" | "held" | "declaration">,
  segment: ((path: RelativePath) => boolean) | null,
): RelativePath[] {
  const closure = new Set([...snapshot.closure, ...snapshot.declaration.configFiles]);
  const program = new Set(snapshot.program);
  const joined: RelativePath[] = [];
  for (const [path, held] of snapshot.held ?? []) {
    if (closure.has(path) || underModules(path)) continue;
    const typescriptOnly = held.others.length === 0 && held.unobserved !== true;
    if (typescriptOnly && program.has(path)) continue;
    if (segment !== null && (program.has(path) || segment(path))) continue;
    joined.push(path);
  }
  return joined.sort();
}

/** What the pass's blobs and the worker's bytes disagree on before a lookup (P1). */
export interface Disagreement {
  /** Closure and config files the worker holds at other bytes: D4's refresh reads them again. */
  readonly loaded: readonly RelativePath[];
  /** Files gone, and others TypeScript holds at other bytes and cannot be fed: its service keeps them, so a new thread. */
  readonly renew: readonly RelativePath[];
  /** Program files only TypeScript holds at other bytes: fed at their key's. */
  readonly feed: readonly RelativePath[];
  /** Other files a rule or a module holds at other bytes: the lint call reads them again, or not. */
  readonly others: readonly RelativePath[];
  /** Files the walk read at other bytes: the program is read again. */
  readonly walked: readonly RelativePath[];
  /** A path the walk's lookups read left the state the walk saw (Q3): the program is read again. */
  readonly lookups: boolean;
}

/**
 * P1: each path the worker holds against the pass's blob, and each file
 * the walk read. A path `settled` names is left out: refreshes did not move
 * it, and the keys that hold it store nothing.
 */
export function disagreement(
  snapshot: LintSnapshot,
  blobOf: KeyBlob,
  settled: (path: RelativePath, blob: FileHash | null) => boolean,
): Disagreement {
  const closure = new Set([...snapshot.closure, ...snapshot.declaration.configFiles]);
  const program = new Set(snapshot.program);
  const out = {
    loaded: [] as RelativePath[],
    renew: [] as RelativePath[],
    feed: [] as RelativePath[],
    others: [] as RelativePath[],
    walked: [] as RelativePath[],
  };
  for (const [path, held] of snapshot.held ?? []) {
    if (underModules(path) || held.unobserved === true) continue;
    const blob = blobOf(path);
    if (heldAt(held, blob) || settled(path, blob)) continue;
    const typescript = held.typescript !== undefined && held.typescript !== blob;
    const others = held.others.some((other) => other !== blob);
    if (blob === null) out.renew.push(path);
    else if (closure.has(path)) out.loaded.push(path);
    else if (typescript && !program.has(path)) out.renew.push(path);
    else if (typescript && !others) out.feed.push(path);
    else out.others.push(path);
  }
  for (const [path, blob] of snapshot.walked ?? []) {
    const now = blobOf(path);
    if (!underModules(path) && now !== blob && !settled(path, now)) out.walked.push(path);
  }
  return { ...out, lookups: false };
}

/** A miss as the lint call gave it: its key's own blob and whether it holds the segment. */
export interface Miss {
  readonly path: RelativePath;
  readonly blob: FileHash;
  readonly wholeProgram: boolean;
}

/** What a lint call's report says of its misses' keys (P2). */
export interface Spoiled {
  /** Misses whose key holds a path the worker holds at other bytes: nothing is stored. */
  readonly spoiled: ReadonlySet<RelativePath>;
  /** Misses whose key holds a path the worker read in a way it cannot hash, with why. */
  readonly unknown: ReadonlyMap<RelativePath, string>;
  /** Paths a rule or a module holds at other bytes than the keys': a refresh, or more, may be due. */
  readonly stuck: readonly RelativePath[];
}

/** The keys' inputs, as the misses' keys hold them. */
export interface KeyInputs {
  /** Every key's: the closure and the config files. */
  readonly closure: ReadonlySet<RelativePath>;
  /** A whole-program key's: the segment holds the path. */
  readonly segment: (path: RelativePath) => boolean;
  readonly blobOf: KeyBlob;
  /** Refreshes did not move the worker's bytes of `path` from `blob`: its keys read `unknown`. */
  readonly settled: (path: RelativePath, blob: FileHash | null) => boolean;
}

/**
 * P2: after a lint call, each path the worker holds against the blob the
 * misses' keys hold it at. A closure file spoils every miss, a segment
 * file every whole-program miss, a miss's own file that miss.
 */
export function spoiled(
  env: Pick<LintEnvironment, "held">,
  keys: KeyInputs,
  misses: readonly Miss[],
): Spoiled {
  const own = new Map(misses.map((miss) => [miss.path, miss]));
  const bad = new Set<RelativePath>();
  const unknown = new Map<RelativePath, string>();
  const stuck: RelativePath[] = [];
  for (const [path, held] of env.held ?? []) {
    if (underModules(path)) continue;
    const mine = own.get(path);
    const inClosure = keys.closure.has(path);
    const inSegment = keys.segment(path);
    const affected = misses.filter(
      (miss) => inClosure || (inSegment && miss.wholeProgram) || miss === mine,
    );
    if (affected.length === 0) continue;
    const blob = inClosure || inSegment || mine === undefined ? keys.blobOf(path) : mine.blob;
    if (heldAt(held, blob) && (mine === undefined || heldAt(held, mine.blob))) continue;
    const why =
      held.unobserved === true
        ? `ESLint read ${path} in a way the worker cannot hash`
        : keys.settled(path, blob)
          ? `ESLint reads ${path} at other bytes than its blob`
          : null;
    if (why !== null) {
      for (const miss of affected) unknown.set(miss.path, why);
      continue;
    }
    for (const miss of affected) bad.add(miss.path);
    if (held.others.some((other) => other !== blob)) stuck.push(path);
  }
  for (const path of unknown.keys()) bad.delete(path);
  return { spoiled: bad, unknown, stuck };
}
