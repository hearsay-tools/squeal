import { createHash } from "node:crypto";
import { posix } from "node:path";
import { compare } from "../fs/compare.js";
import type { RelativePath } from "../types/common.js";
import { type Analysis, analyze, type FileReach, type Route, type Seconds } from "./analyze.js";
import { proposals } from "./proposals.js";
import {
  type FileEntry,
  type NamedFile,
  REACH_REPORT_VERSION,
  type ReachReport,
  type ReachRoute,
  type Split,
  type TestEntry,
} from "./report-types.js";
import { BY_DESIGN, suggestionFor } from "./suggest.js";
import type { ReachSnapshot } from "./types.js";

/*
 * Spec 015 D11 "The report, with history": two parts ranked by avoidable
 * seconds per edit, then by reach seconds. Files that share their main
 * gateway and their reach collapse into one entry.
 */

export interface ReportOptions {
  /** Named files or folders, given in full; `null` for the ranked parts only. */
  readonly paths: readonly RelativePath[] | null;
  /** Entries per part; `null` for every entry. */
  readonly limit: number | null;
  /** How the text names the CLI (`statusCommand`). */
  readonly command: string;
  /** Test files the daemon listed; `null` when it listed none yet. */
  readonly listed: number | null;
}

const named = (paths: readonly RelativePath[]) => (path: RelativePath) =>
  paths.some((p) => p === "" || path === p || path.startsWith(`${p}/`));

export function buildReport(snapshot: ReachSnapshot, options: ReportOptions): ReachReport {
  const isNamed = options.paths === null ? () => false : named(options.paths);
  const analysis = analyze(snapshot, isNamed);
  const { suite } = analysis;
  const history = suite.testFiles > 0 && suite.withoutSeconds < suite.testFiles;
  const times = snapshot.edits.map((e) => e.at);
  const files = history ? fileEntries(analysis, snapshot) : [];
  const tests = history ? testEntries(analysis) : [];
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const unmeasured = snapshot.coverage.on
    ? analysis.tests
        .filter((t) => t.test.coverage.kind === "unknown")
        .map((t) => RUNNER_NAMES[t.test.runner])
    : [];
  return {
    v: REACH_REPORT_VERSION,
    history,
    suite,
    window:
      times.length === 0
        ? null
        : { from: Math.min(...times), to: Math.max(...times), edits: times.length },
    coverage: snapshot.coverage.on ? "on" : "off",
    unmeasured: [...new Set(unmeasured)].sort(compare),
    edges: snapshot.graph !== null,
    notRecorded: [...analysis.files.values()].reduce((n, f) => n + f.notRecorded, 0),
    files: files.slice(0, limit),
    moreFiles: Math.max(0, files.length - limit),
    testFiles: tests.slice(0, limit),
    moreTestFiles: Math.max(0, tests.length - limit),
    ...(options.paths === null || !history
      ? {}
      : { named: namedFiles(analysis, snapshot, options.paths, isNamed) }),
    proposals: proposals(snapshot, analysis, history, options),
  };
}

const RUNNER_NAMES = { vitest: "Vitest", nodeTest: "node:test", pytest: "pytest" } as const;

/** Seconds as shares of `total`, leaving out the zeros. */
function split<K extends string>(seconds: Seconds<K>, total: number): Split<K> {
  const out: Split<K> = {};
  for (const [key, value] of Object.entries(seconds) as [K, number][]) {
    if (value > 0 && total > 0) out[key] = value / total;
  }
  return out;
}

/** The route with the most seconds, then test files, then the first by gateway. */
function mainRoute(file: FileReach): Route | null {
  let best: Route | null = null;
  for (const route of file.routes.values()) {
    if (
      best === null ||
      route.seconds > best.seconds ||
      (route.seconds === best.seconds && route.testFiles > best.testFiles)
    ) {
      best = route;
    }
  }
  return best;
}

function routeOf(route: Route): ReachRoute {
  const { kind, gateway, chain, testFiles, seconds } = route;
  return { kind, gateway, chain, testFiles, seconds, coverage: split(route.coverage, seconds) };
}

const NOTED = new Set(["child process", "runtime read"]);

function fileEntries(analysis: Analysis, snapshot: ReachSnapshot): FileEntry[] {
  const groups = new Map<string, { files: FileReach[]; route: Route | null }>();
  for (const file of analysis.files.values()) {
    const route = mainRoute(file);
    const reach = createHash("sha1").update(file.reach.join(",")).digest("hex");
    const key =
      route?.gateway == null ? `\0${file.path}` : `${route.kind}\0${route.gateway}\0${reach}`;
    const group = groups.get(key) ?? { files: [], route };
    group.files.push(file);
    groups.set(key, group);
  }
  const total = analysis.suite.seconds;
  const entries = [...groups.values()].map(({ files, route }) => {
    const paths = files.map((f) => f.path).sort(compare);
    const [first] = files as [FileReach];
    const mean = (f: (x: FileReach) => number) =>
      files.reduce((s, x) => s + f(x), 0) / files.length;
    const edits = files.reduce((n, f) => n + (analysis.edits.get(f.path) ?? 0), 0);
    const coverage = sum(files.map((f) => f.coverage));
    const kinds = sum(files.map((f) => f.kinds));
    const seconds = mean((f) => f.seconds);
    const entry: FileEntry = {
      files: paths,
      folder: paths.length > 1 ? commonFolder(paths) : null,
      testFiles: first.testFiles,
      seconds,
      share: total > 0 ? seconds / total : 0,
      avoidableSeconds: mean((f) => f.avoidable),
      edits,
      editSeconds: files.reduce((s, f) => s + (analysis.edits.get(f.path) ?? 0) * f.seconds, 0),
      coverage: split(coverage, seconds * files.length),
      kinds: split(kinds, seconds * files.length),
      gateway: route?.gateway == null ? null : routeOf(route),
      suggestion: route === null ? null : suggestionFor(paths, route, snapshot),
      ...(route !== null && NOTED.has(route.kind) ? { note: BY_DESIGN } : {}),
    };
    return entry;
  });
  return entries.sort(
    (a, b) =>
      b.avoidableSeconds - a.avoidableSeconds ||
      b.seconds - a.seconds ||
      compare(a.files[0] ?? "", b.files[0] ?? ""),
  );
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

function testEntries(analysis: Analysis): TestEntry[] {
  const entries = analysis.tests
    .filter((t) => t.imports > 0)
    .map((t): TestEntry & { readonly reachSeconds: number } => {
      const seconds = t.test.seconds;
      let via: TestEntry["via"] = null;
      for (const [path, uncalled] of t.uncalledVia) {
        if (via === null || uncalled > via.uncalled) via = { path, uncalled };
      }
      return {
        project: t.test.ref.project,
        path: t.test.ref.path,
        seconds,
        sources: t.imports,
        called: t.called,
        edits: t.edits,
        via,
        avoidableSeconds: (seconds ?? 0) * t.uncalled,
        reachSeconds: (seconds ?? 0) * t.sources,
      };
    });
  entries.sort(
    (a, b) =>
      b.avoidableSeconds - a.avoidableSeconds ||
      b.reachSeconds - a.reachSeconds ||
      compare(a.path, b.path),
  );
  return entries.map(({ reachSeconds: _, ...entry }) => entry);
}

function namedFiles(
  analysis: Analysis,
  snapshot: ReachSnapshot,
  paths: readonly RelativePath[],
  isNamed: (path: RelativePath) => boolean,
): NamedFile[] {
  const total = analysis.suite.seconds;
  const files = [...analysis.files.values()].filter((f) => isNamed(f.path));
  const found = new Set(files.map((f) => f.path));
  const absent = paths.filter((p) => ![...found].some((f) => named([p])(f)));
  return [
    ...files
      .sort((a, b) => compare(a.path, b.path))
      .map((file): NamedFile => {
        const route = mainRoute(file);
        const routes = [...file.routes.values()].sort((a, b) => b.seconds - a.seconds);
        return {
          path: file.path,
          testFiles: file.testFiles,
          seconds: file.seconds,
          share: total > 0 ? file.seconds / total : 0,
          edits: analysis.edits.get(file.path) ?? 0,
          coverage: split(file.coverage, file.seconds),
          routes: routes.map((r) => ({
            ...routeOf(r),
            tests: [...(r.tests ?? [])].sort(
              (a, b) => (b.seconds ?? 0) - (a.seconds ?? 0) || compare(a.path, b.path),
            ),
          })),
          suggestion: route === null ? null : suggestionFor([file.path], route, snapshot),
          ...(route !== null && NOTED.has(route.kind) ? { note: BY_DESIGN } : {}),
        };
      }),
    ...absent.map((path) => ({
      path,
      testFiles: 0,
      seconds: 0,
      share: 0,
      edits: analysis.edits.get(path) ?? 0,
      coverage: {},
      routes: [],
      suggestion: null,
    })),
  ];
}
