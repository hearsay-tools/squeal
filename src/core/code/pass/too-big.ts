import type { RelativePath, RevisionNumber, WorktreeId } from "../../types/index.js";
import type { CodeMetaRepo, CodeStore } from "../store/index.js";
import type { Entry } from "./blobs.js";

/*
 * Spec 015 D6, a file too big to count (review 0.1.297-r2 N1): each such
 * file's last edit, at the revision that made it. A first count or a
 * recount writes every files row at its own revision, which is no edit, so
 * the edit's revision is kept apart from the rows, and a second recount
 * keeps the first's. The delivery tells an edit in the session's revisions.
 */

/** Code meta `tooBigEdits:<worktreeId>`: `[path, revision]` pairs. */
const editsKey = (worktreeId: WorktreeId) => `tooBigEdits:${worktreeId}`;

/** Each file too big to count and the revision of its last edit; empty when none is or the record does not read. */
export function readTooBigEdits(
  meta: CodeMetaRepo,
  worktreeId: WorktreeId,
): Map<RelativePath, RevisionNumber> {
  const text = meta.get(editsKey(worktreeId));
  if (text === null) return new Map();
  try {
    const pairs: unknown = JSON.parse(text);
    if (!Array.isArray(pairs)) return new Map();
    return new Map(
      pairs.filter(
        (p): p is [RelativePath, RevisionNumber] =>
          Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "number",
      ),
    );
  } catch {
    return new Map();
  }
}

/**
 * A pass over the revisions `changed` names, each path with the last that
 * changed it: a file of `entries` too big to count whose blob is not its
 * stored row's gets that revision, and a path of `entries` that is not too
 * big leaves the record. Read before the pass writes the rows. With
 * `changed` `null`, a first count, the record starts again: no row before
 * it is an edit. Writes only what changes.
 */
export function writeTooBigEdits(
  store: Pick<CodeStore, "files" | "meta">,
  worktreeId: WorktreeId,
  changed: ReadonlyMap<RelativePath, RevisionNumber> | null,
  entries: readonly Entry[],
): void {
  const { meta } = store;
  if (changed === null) {
    if (meta.get(editsKey(worktreeId)) !== null) meta.delete(editsKey(worktreeId));
    return;
  }
  const edits = readTooBigEdits(meta, worktreeId);
  const big = entries.flatMap((e) => (e.kind === "big" && changed.has(e.path) ? [e.path] : []));
  const rows = big.length === 0 ? [] : store.files.list(worktreeId, big);
  const stored = new Map(rows.map((f) => [f.path, f.blob]));
  let writes = false;
  for (const e of entries) {
    const at = changed.get(e.path);
    if (e.kind !== "big") writes = edits.delete(e.path) || writes;
    else if (at !== undefined && stored.get(e.path) !== e.file.hash && edits.get(e.path) !== at) {
      edits.set(e.path, at);
      writes = true;
    }
  }
  if (!writes) return;
  if (edits.size === 0) meta.delete(editsKey(worktreeId));
  else meta.set(editsKey(worktreeId), JSON.stringify([...edits]));
}
