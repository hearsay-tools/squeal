import type { CodeStore } from "../code/store/types.js";
import type { CodeKnownState, CodeMeasure } from "../types/code.js";
import type { CodeNews } from "../types/code-delivery.js";
import type { Consumer, WorktreeId } from "../types/index.js";
import { coverageMeasures } from "./code-coverage.js";
import { codeKey } from "./code-delta.js";

/*
 * Row 015-27 (the human, 2026-10-24): the functions a session was told of
 * in full, as a FAIL or a STILL FAIL, that are over now. Test news ends
 * with their number, and `squeal code --told` lists them, from this one
 * read so the two agree. A function a view holds by count (over since
 * before the session, or past the listed limit) is not among them. Row
 * 015-40: the `crap` and `uncovered` states too, each measure counted apart.
 */

/** The failing states of `measures` in `worktreeId` that any of `consumers` was told of in full. */
export function toldOver(
  store: CodeStore,
  worktreeId: WorktreeId,
  consumers: readonly Consumer[],
  measures: readonly CodeMeasure[] = ["complexity"],
): CodeKnownState[] {
  const told = new Set(
    consumers.flatMap((c) =>
      store.views
        .list(c)
        .filter((v) => measures.includes(v.measure) && v.told !== "count")
        .map(codeKey),
    ),
  );
  if (told.size === 0) return [];
  return measures.flatMap((measure) =>
    store.states.list(worktreeId, { measure, outcome: "fail" }).filter((s) => told.has(codeKey(s))),
  );
}

/** `news` with `consumer`'s functions told over (`CodeNews.toldOver`), when there are any. */
export function withToldOver(
  store: CodeStore,
  consumer: Consumer,
  news: CodeNews | null,
  threshold: number,
): CodeNews | null {
  const { worktreeId } = consumer;
  const measures = ["complexity", ...coverageMeasures(store, worktreeId)] as const;
  const over = toldOver(store, worktreeId, [consumer], measures);
  if (over.length === 0) return news;
  const count = over.filter((s) => s.measure === "complexity").length;
  const crap = over.filter((s) => s.measure === "crap");
  const uncovered = over.filter((s) => s.measure === "uncovered").length;
  const [first] = crap;
  const told = {
    count,
    threshold,
    ...(first?.threshold == null
      ? {}
      : { crap: { count: crap.length, threshold: first.threshold } }),
    ...(uncovered === 0 ? {} : { uncovered }),
  };
  return { ...(news ?? { v: 1, entries: [], more: 0 }), toldOver: told };
}
