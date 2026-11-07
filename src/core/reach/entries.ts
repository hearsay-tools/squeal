import { createHash } from "node:crypto";
import { posix } from "node:path";
import { compare } from "../fs/compare.js";
import type { RelativePath } from "../types/common.js";
import {
  type Analysis,
  type FileReach,
  type Route,
  rankedSeconds,
  type Seconds,
} from "./analyze.js";
import { IMPORT_KINDS, type PathKind } from "./pairs.js";
import type { FileEntry, ReachRoute, Split, TestEntry } from "./report-types.js";
import { BY_DESIGN, secondGateway, suggestionFor, typesOnlyThrough } from "./suggest.js";
import type { ReachSnapshot } from "./types.js";

/*
 * Spec 015 D11 "The report, with history": the entries of both parts.
 * Files that share their main route's kind and gateway and their reach
 * collapse into one entry. The order counts avoidable seconds, and import
 * seconds whose coverage is unknown (015-116, P8).
 */

/** Seconds as shares of `total`, leaving out the zeros. */
export function split<K extends string>(seconds: Seconds<K>, total: number): Split<K> {
  const out: Split<K> = {};
  for (const [key, value] of Object.entries(seconds) as [K, number][]) {
    if (value > 0 && total > 0) out[key] = value / total;
  }
  return out;
}

/**
 * The route an entry is named by (015-116, P3): of the routes with avoidable
 * seconds when there are any, the one with the most, so an entry ranked by
 * its import seconds names its import gateway; else the route with the most
 * seconds. Then by test files, then the first found.
 */
export function mainRoute(file: FileReach): Route | null {
  const routes = [...file.routes.values()];
  const ranked = routes.filter((r) => rankedSeconds(r) > 0);
  let best: Route | null = null;
  for (const route of ranked.length > 0 ? ranked : routes) {
    if (best === null || better(route, best)) best = route;
  }
  return best;
}

function better(a: Route, b: Route): boolean {
  const byRank = rankedSeconds(a) - rankedSeconds(b);
  if (byRank !== 0) return byRank > 0;
  return a.seconds > b.seconds || (a.seconds === b.seconds && a.testFiles > b.testFiles);
}

export function routeOf(route: Route): ReachRoute {
  const { kind, gateway, chain, testFiles, seconds } = route;
  return { kind, gateway, chain, testFiles, seconds, coverage: split(route.coverage, seconds) };
}

const BY_DESIGN_KINDS: ReadonlySet<PathKind> = new Set(["child process", "runtime read"]);

/** The note, when child-process and runtime-read seconds outweigh import seconds (015-116, P3). */
export function noteOf(kinds: Seconds<PathKind>): { readonly note?: string } {
  let byDesign = 0;
  let imports = 0;
  for (const [kind, seconds] of Object.entries(kinds) as [PathKind, number][]) {
    if (BY_DESIGN_KINDS.has(kind)) byDesign += seconds;
    if (IMPORT_KINDS.has(kind)) imports += seconds;
  }
  return byDesign > imports ? { note: BY_DESIGN } : {};
}

/** The entries of part 1 in both orders: by ranked seconds per edit, and by the window's edits (015-118). */
export function fileEntries(
  analysis: Analysis,
  snapshot: ReachSnapshot,
): { readonly files: FileEntry[]; readonly byEdits: FileEntry[] } {
  const ranked = groups(analysis, snapshot)
    .map((group) => entryOf(group, analysis, snapshot))
    .sort(
      (a, b) =>
        rank(b) - rank(a) || b.seconds - a.seconds || compare(a.files[0] ?? "", b.files[0] ?? ""),
    );
  const files = ranked.map((entry, at) => ({ ...entry, rank: at + 1 }));
  const byEdits = files
    .filter((e) => e.editSeconds > 0)
    .sort((a, b) => b.editSeconds - a.editSeconds || a.rank - b.rank);
  return { files, byEdits };
}

const rank = (e: Omit<FileEntry, "rank">) => e.avoidableSeconds + e.unknownSeconds;

interface Group {
  readonly files: FileReach[];
  /** Of its files' main routes, the one with the most avoidable seconds: its suggestion's evidence. */
  route: Route | null;
}

function groups(analysis: Analysis, snapshot: ReachSnapshot): Group[] {
  const out = new Map<string, Group>();
  for (const file of analysis.files.values()) {
    const route = mainRoute(file);
    const reach = createHash("sha1").update(file.reach.join(",")).digest("hex");
    // Without a gateway (no stored edges, a declared input, a runtime read) the kind and its pattern stand in.
    const via = route?.gateway ?? `${route?.declared?.tests}\0${route?.declared?.input}`;
    // P4 and P6: a types-only file, and the files of a second gateway, get their own entry and text.
    const typesOnly = route !== null && typesOnlyThrough(file.path, route, snapshot);
    const second = route === null ? null : secondGateway([file.path], route, snapshot);
    const apart = `${typesOnly}\0${second?.gateway ?? ""}`;
    const key = route === null ? `\0${file.path}` : `${route.kind}\0${via}\0${reach}\0${apart}`;
    const group = out.get(key) ?? { files: [], route };
    group.files.push(file);
    if (route !== null && group.route !== null && better(route, group.route)) group.route = route;
    out.set(key, group);
  }
  return [...out.values()];
}

function entryOf(
  { files, route }: Group,
  analysis: Analysis,
  snapshot: ReachSnapshot,
): Omit<FileEntry, "rank"> {
  const paths = files.map((f) => f.path).sort(compare);
  const [first] = files as [FileReach];
  const mean = (f: (x: FileReach) => number) => files.reduce((s, x) => s + f(x), 0) / files.length;
  const kinds = sum(files.map((f) => f.kinds));
  const seconds = mean((f) => f.seconds);
  const total = analysis.suite.seconds;
  return {
    files: paths,
    folder: paths.length > 1 ? commonFolder(paths) : null,
    testFiles: first.testFiles,
    seconds,
    share: total > 0 ? seconds / total : 0,
    avoidableSeconds: mean((f) => f.avoidable),
    unknownSeconds: mean((f) => f.unknown),
    edits: files.reduce((n, f) => n + (analysis.edits.get(f.path) ?? 0), 0),
    editSeconds: files.reduce((s, f) => s + (analysis.edits.get(f.path) ?? 0) * f.seconds, 0),
    coverage: split(sum(files.map((f) => f.coverage)), seconds * files.length),
    kinds: split(kinds, seconds * files.length),
    kind: route?.kind ?? "import",
    gateway: route?.gateway == null ? null : routeOf(route),
    second: route === null ? null : secondGateway(paths, route, snapshot),
    suggestion: route === null ? null : suggestionFor(paths, route, snapshot),
    ...noteOf(kinds),
  };
}

function sum<K extends string>(parts: readonly Seconds<K>[]): Seconds<K> {
  const out = { ...parts[0] } as Seconds<K>;
  for (const part of parts.slice(1)) {
    for (const [k, v] of Object.entries(part) as [K, number][]) out[k] += v;
  }
  return out;
}

/** `src/core/types` for `src/core/types/a.ts` and `src/core/types/b.ts`; `.` for none shared. */
function commonFolder(paths: readonly RelativePath[]): RelativePath {
  let folder = posix.dirname(paths[0] ?? "");
  while (folder !== "." && !paths.every((p) => p.startsWith(`${folder}/`))) {
    folder = posix.dirname(folder);
  }
  return folder;
}

/**
 * Part 2, by avoidable pair-seconds; a test file whose coverage is unknown
 * ranks by its seconds times every import-path source (015-116, P8 and P12).
 */
export function testEntries(analysis: Analysis): TestEntry[] {
  const entries = analysis.tests
    .filter((t) => t.imports > 0)
    .map((t) => {
      const seconds = t.test.seconds ?? 0;
      let via: TestEntry["via"] = null;
      for (const [path, uncalled] of t.uncalledVia) {
        if (via === null || uncalled > via.uncalled) via = { path, uncalled };
      }
      const entry: TestEntry = {
        project: t.test.ref.project,
        path: t.test.ref.path,
        seconds: t.test.seconds,
        sources: t.imports,
        called: t.called,
        edits: t.edits,
        via,
        avoidablePairSeconds: seconds * t.uncalled,
      };
      const unknown = t.test.coverage.kind === "unknown";
      return {
        entry,
        rank: seconds * (unknown ? t.imports : t.uncalled),
        all: seconds * t.sources,
      };
    });
  entries.sort((a, b) => b.rank - a.rank || b.all - a.all || compare(a.entry.path, b.entry.path));
  return entries.map(({ entry }) => entry);
}
