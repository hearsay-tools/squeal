import type { CodeStore } from "../code/store/types.js";
import type { CodeKnownState } from "../types/code.js";
import type { CodeNews } from "../types/code-delivery.js";
import type { Consumer, WorktreeId } from "../types/index.js";
import { codeKey } from "./code-delta.js";

/*
 * Row 015-27 (the human, 2026-10-24): the functions a session was told of
 * in full, as a FAIL or a STILL FAIL, that are over now. Test news ends
 * with their number, and `squeal code --told` lists them, from this one
 * read so the two agree. A function a view holds by count (over since
 * before the session, or past the listed limit) is not among them.
 */

/** The failing functions of `worktreeId` that any of `consumers` was told of in full. */
export function toldOver(
  store: CodeStore,
  worktreeId: WorktreeId,
  consumers: readonly Consumer[],
): CodeKnownState[] {
  const told = new Set(
    consumers.flatMap((c) =>
      store.views
        .list(c)
        .filter((v) => v.measure === "complexity" && v.told !== "count")
        .map(codeKey),
    ),
  );
  if (told.size === 0) return [];
  return store.states
    .list(worktreeId, { measure: "complexity", outcome: "fail" })
    .filter((s) => told.has(codeKey(s)));
}

/** `news` with `consumer`'s functions told over (`CodeNews.toldOver`), when there are any. */
export function withToldOver(
  store: CodeStore,
  consumer: Consumer,
  news: CodeNews | null,
  threshold: number,
): CodeNews | null {
  const count = toldOver(store, consumer.worktreeId, [consumer]).length;
  if (count === 0) return news;
  return { ...(news ?? { v: 1, entries: [], more: 0 }), toldOver: { count, threshold } };
}
