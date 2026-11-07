import type { RelativePath } from "../types/common.js";
import {
  COVERAGE_STATES,
  type CoverageState,
  IMPORT_KINDS,
  PATH_KINDS,
  type Pair,
  PairContext,
  type PathKind,
  pairsOf,
} from "./pairs.js";
import type { DeclaredPattern, ReachSnapshot, ReachTestFile } from "./types.js";

/*
 * Spec 015 D11: every pair of the suite summed per source file and per test
 * file. Seconds are recorded seconds; a test file without them counts as a
 * test file and adds no seconds, so it is left out of every share.
 */

export type Seconds<K extends string> = Record<K, number>;

const zero = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Seconds<K>;

/** The pairs of one file that share a path kind and a gateway. */
export interface Route {
  readonly kind: PathKind;
  readonly gateway: RelativePath | null;
  /** The first pair's chain. */
  readonly chain: readonly RelativePath[];
  testFiles: number;
  seconds: number;
  /** Test files whose coverage says they never call the file: loaded only or not loaded. */
  uncalled: number;
  /** Test files whose coverage tells: called, loaded only or not loaded. */
  measured: number;
  readonly coverage: Seconds<CoverageState>;
  readonly declared?: DeclaredPattern;
  /** With `detail`, each test file of the route. */
  readonly tests?: { path: RelativePath; seconds: number | null; coverage: CoverageState }[];
}

export interface FileReach {
  readonly path: RelativePath;
  testFiles: number;
  withoutSeconds: number;
  seconds: number;
  /** Seconds of its `import` pairs that are loaded only or not loaded (D11). */
  avoidable: number;
  readonly kinds: Seconds<PathKind>;
  readonly coverage: Seconds<CoverageState>;
  readonly routes: Map<string, Route>;
  /** The suite's index of each test file of its reach, ascending. */
  readonly reach: number[];
  /** `import` pairs the stored edges do not reach yet. */
  notRecorded: number;
}

export interface TestReach {
  readonly test: ReachTestFile;
  /** Source files an edit of which re-runs it. */
  sources: number;
  /** Of them, on an `import` path. */
  imports: number;
  /** `import` sources it calls; `null` when its coverage cannot tell. */
  called: number | null;
  /** `import` sources it loads only or does not load. */
  uncalled: number;
  /** By the test file's own direct import that brings them in, its uncalled sources. */
  readonly uncalledVia: Map<RelativePath, number>;
  /** Window edits that changed it or a file of its reach. */
  edits: number;
}

export interface Analysis {
  readonly suite: {
    readonly testFiles: number;
    readonly seconds: number;
    readonly withoutSeconds: number;
    /** Test files of groups at `manual`, left out. */
    readonly leftOut: number;
  };
  readonly files: ReadonlyMap<RelativePath, FileReach>;
  readonly tests: readonly TestReach[];
  /** Per path, the edits that changed it. */
  readonly edits: ReadonlyMap<RelativePath, number>;
}

const UNCALLED: ReadonlySet<CoverageState> = new Set(["loaded only", "not loaded"]);
const MEASURED: ReadonlySet<CoverageState> = new Set(["called", "loaded only", "not loaded"]);

/** Sums every pair of the suite; `detail` keeps each test file of a named file's routes. */
export function analyze(
  snapshot: ReachSnapshot,
  detail: (path: RelativePath) => boolean = () => false,
): Analysis {
  const context = new PairContext(snapshot);
  const suite = snapshot.testFiles.filter((t) => t.inSuite);
  const edits = new Map<RelativePath, number>();
  for (const edit of snapshot.edits) {
    for (const path of new Set(edit.paths)) edits.set(path, (edits.get(path) ?? 0) + 1);
  }
  const files = new Map<RelativePath, FileReach>();
  const tests = suite.map((test, index) => {
    const pairs = test.closure === null ? [] : pairsOf(test, context);
    for (const pair of pairs) addPair(files, pair, test, index, detail(pair.path));
    return testReach(test, pairs, snapshot);
  });
  return {
    suite: {
      testFiles: suite.length,
      seconds: suite.reduce((sum, t) => sum + (t.seconds ?? 0), 0),
      withoutSeconds: suite.filter((t) => t.seconds === null).length,
      leftOut: snapshot.testFiles.length - suite.length,
    },
    files,
    tests,
    edits,
  };
}

function addPair(
  files: Map<RelativePath, FileReach>,
  pair: Pair,
  test: ReachTestFile,
  index: number,
  detail: boolean,
) {
  let file = files.get(pair.path);
  if (file === undefined) {
    file = {
      path: pair.path,
      testFiles: 0,
      withoutSeconds: 0,
      seconds: 0,
      avoidable: 0,
      kinds: zero(PATH_KINDS),
      coverage: zero(COVERAGE_STATES),
      routes: new Map(),
      reach: [],
      notRecorded: 0,
    };
    files.set(pair.path, file);
  }
  const seconds = test.seconds ?? 0;
  file.testFiles++;
  if (test.seconds === null) file.withoutSeconds++;
  file.seconds += seconds;
  file.kinds[pair.kind] += seconds;
  file.coverage[pair.coverage] += seconds;
  if (IMPORT_KINDS.has(pair.kind) && UNCALLED.has(pair.coverage)) file.avoidable += seconds;
  if (pair.notRecorded === true) file.notRecorded++;
  file.reach.push(index);
  const declared =
    pair.declared === undefined ? "" : `${pair.declared.tests}\0${pair.declared.input}`;
  const key = `${pair.kind}\0${pair.gateway ?? ""}\0${declared}`;
  let route = file.routes.get(key);
  if (route === undefined) {
    route = {
      kind: pair.kind,
      gateway: pair.gateway,
      chain: pair.chain,
      testFiles: 0,
      seconds: 0,
      uncalled: 0,
      measured: 0,
      coverage: zero(COVERAGE_STATES),
      ...(pair.declared === undefined ? {} : { declared: pair.declared }),
      ...(detail ? { tests: [] } : {}),
    };
    file.routes.set(key, route);
  }
  route.testFiles++;
  route.seconds += seconds;
  route.coverage[pair.coverage] += seconds;
  if (UNCALLED.has(pair.coverage)) route.uncalled++;
  if (MEASURED.has(pair.coverage)) route.measured++;
  route.tests?.push({ path: test.ref.path, seconds: test.seconds, coverage: pair.coverage });
}

function testReach(test: ReachTestFile, pairs: readonly Pair[], snapshot: ReachSnapshot) {
  const imports = pairs.filter((p) => IMPORT_KINDS.has(p.kind));
  const uncalled = imports.filter((p) => UNCALLED.has(p.coverage));
  const uncalledVia = new Map<RelativePath, number>();
  for (const pair of uncalled) {
    const via = pair.chain[1];
    if (via !== undefined) uncalledVia.set(via, (uncalledVia.get(via) ?? 0) + 1);
  }
  const reach = new Set(pairs.map((p) => p.path)).add(test.ref.path);
  const tells = test.coverage.kind === "record";
  return {
    test,
    sources: pairs.length,
    imports: imports.length,
    called: tells ? imports.filter((p) => p.coverage === "called").length : null,
    uncalled: uncalled.length,
    uncalledVia,
    edits: snapshot.edits.filter((e) => e.paths.some((p) => reach.has(p))).length,
  };
}
