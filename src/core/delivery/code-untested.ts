import { functionKey, readEvidence } from "../code/crap/index.js";
import type { CodeStore } from "../code/store/types.js";
import type { CodeDeltaEntry, CodeDeltaKind, CodeNews } from "../types/code-delivery.js";
import type { Consumer, RelativePath } from "../types/index.js";

/*
 * Row 015-65, spec 015 D9 Delivery as amended 2026-10-26: what an
 * `untested` FAIL or STILL FAIL line states Squeal saw. How many test files
 * load the function's file, from the main store's closures; whether they
 * may run it in a process they start, from the file's evidence (the
 * coordinator's choice, 2026-10-26: a loader and no function of the file
 * ran, so the module loads and nothing in it is called); its CRAP while it
 * is judged; and once per consumer, `coverage.exclude`.
 */

/** Test files whose closure holds a path, read only when a line needs them. */
export type LoaderCount = () => (path: RelativePath) => number;

/** The kinds of an `uncovered` change whose line says why no test runs the function. */
const SAYS_WHY: ReadonlySet<CodeDeltaKind> = new Set([
  "first-seen-fail",
  "pass-to-fail",
  "edited",
  "edited-after-fail",
]);

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
 * `news` with its `untested` FAIL and STILL FAIL entries' facts, and
 * `excludeHint` the first time `consumer` gets a line that says a test may
 * start a process, recorded as told. Call inside the delivery's code store
 * transaction. The loaders are read only when such an entry is listed.
 */
export function withUntested(
  store: CodeStore,
  consumer: Consumer,
  news: CodeNews | null,
  loaders: LoaderCount | undefined,
): CodeNews | null {
  const says = (e: CodeDeltaEntry) =>
    e.measure === "uncovered" && SAYS_WHY.has(e.kind) && e.evidence !== undefined;
  if (news === null || loaders === undefined || !news.entries.some(says)) return news;
  const count = loaders();
  const ran = new Map<RelativePath, boolean>();
  const entries = news.entries.map((e): CodeDeltaEntry => {
    if (!says(e) || e.evidence === undefined) return e;
    const { path } = e.check;
    const n = count(path);
    if (n > 0 && !ran.has(path)) ran.set(path, !noneRan(store, consumer, path));
    const crap = crapOf(store, consumer, e);
    return {
      ...e,
      evidence: {
        ...e.evidence,
        loaders: n,
        ...(n > 0 && ran.get(path) === false ? { processes: true as const } : {}),
        ...(crap === undefined ? {} : { crap }),
      },
    };
  });
  const processes = entries.some((e) => e.evidence?.processes === true);
  const hint = processes && store.meta.get(excludeToldKey(consumer)) === null;
  if (hint) store.meta.set(excludeToldKey(consumer), JSON.stringify(true));
  return { ...news, entries, ...(hint ? { excludeHint: true as const } : {}) };
}
