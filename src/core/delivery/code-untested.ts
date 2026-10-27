import { functionKey, readEvidence } from "../code/crap/index.js";
import type { CodeStore } from "../code/store/types.js";
import type {
  CodeDeltaEntry,
  CodeDeltaKind,
  CodeFileLoaders,
  CodeNews,
} from "../types/code-delivery.js";
import type { Consumer, RelativePath } from "../types/index.js";

/*
 * Row 015-65, spec 015 D9 Delivery as amended 2026-10-26: what an
 * `untested` FAIL or STILL FAIL line states Squeal saw. How many test files
 * load the function's file, from the main store's closures; whether they
 * may run it in a process they start, from the file's evidence (the
 * coordinator's choice, 2026-10-26: a loader and no function of the file
 * ran, so the module loads and nothing in it is called); its CRAP while it
 * is judged; and once per consumer, `coverage.exclude`. Row 015-81 (D9,
 * amended 2026-10-27): the first two are read once per file in a delivery,
 * and every line of the file that says why no test runs a function gets
 * them, a CRAP line's and one with no evidence too.
 */

/** Test files whose closure holds a path, read only when a line needs them. */
export type LoaderCount = () => (path: RelativePath) => number;

/** The kinds of a change whose line says why no test runs the function. */
const SAYS_WHY: ReadonlySet<CodeDeltaKind> = new Set([
  "first-seen-fail",
  "pass-to-fail",
  "edited",
  "edited-after-fail",
]);

/** An `untested` FAIL or STILL FAIL, or a CRAP one whose evidence says no test runs it. */
const saysWhy = (e: CodeDeltaEntry) =>
  SAYS_WHY.has(e.kind) &&
  (e.measure === "uncovered" || (e.measure === "crap" && e.evidence?.testFiles === 0));

/** Code `meta` key: `consumer` was told `coverage.exclude` (row 015-65, once per consumer). */
export const excludeToldKey = (c: Consumer) =>
  `excludeTold:${c.worktreeId}:${c.sessionId}:${c.agentId}`;

/** No function of the file ran in any test at its last judgement. */
function noneRan(store: CodeStore, consumer: Consumer, path: RelativePath): boolean {
  const evidence = readEvidence(store.meta, consumer.worktreeId, path);
  const functions = Object.values(evidence?.functions ?? {});
  return functions.length > 0 && functions.every(([, , testFiles]) => testFiles === 0);
}

/** The function's CRAP now; `undefined` while it is not judged, or CRAP is off. */
function crapOf(store: CodeStore, consumer: Consumer, entry: CodeDeltaEntry): number | undefined {
  const key = functionKey(entry.check);
  const state = store.states
    .list(consumer.worktreeId, { paths: [entry.check.path], measure: "crap" })
    .find((s) => functionKey(s.check) === key);
  return (state?.outcome === "pass" || state?.outcome === "fail") && state.value !== null
    ? state.value
    : undefined;
}

/**
 * `news` with its file's loaders on each entry whose line says why no test
 * runs the function, its CRAP on each `untested` one, and `excludeHint` the
 * first time `consumer` gets a line that says a test may start a process,
 * recorded as told. Call inside the delivery's code store transaction. The
 * loaders are read only when such an entry is listed, and once per path.
 */
export function withUntested(
  store: CodeStore,
  consumer: Consumer,
  news: CodeNews | null,
  loaders: LoaderCount | undefined,
): CodeNews | null {
  if (news === null || loaders === undefined || !news.entries.some(saysWhy)) return news;
  const count = loaders();
  const files = new Map<RelativePath, CodeFileLoaders>();
  const fileOf = (path: RelativePath): CodeFileLoaders => {
    const known = files.get(path);
    if (known !== undefined) return known;
    const n = count(path);
    const facts =
      n > 0 && noneRan(store, consumer, path)
        ? { count: n, processes: true as const }
        : { count: n };
    files.set(path, facts);
    return facts;
  };
  const entries = news.entries.map((e): CodeDeltaEntry => {
    if (!saysWhy(e)) return e;
    const fileLoaders = fileOf(e.check.path);
    const own = e.measure === "uncovered" && e.evidence !== undefined;
    const crap = own ? crapOf(store, consumer, e) : undefined;
    return {
      ...e,
      fileLoaders,
      ...(e.evidence === undefined || crap === undefined
        ? {}
        : { evidence: { ...e.evidence, crap } }),
    };
  });
  const processes = entries.some(
    (e) => e.measure === "uncovered" && e.fileLoaders?.processes === true,
  );
  const hint = processes && !toldBefore(store, excludeToldKey(consumer));
  return { ...news, entries, ...(hint ? { excludeHint: true as const } : {}) };
}

/** Whether the told mark at `key` was there; it is from now on. */
function toldBefore(store: CodeStore, key: string): boolean {
  if (store.meta.get(key) !== null) return true;
  store.meta.set(key, JSON.stringify(true));
  return false;
}
