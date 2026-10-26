import { extname } from "node:path";
import { CODE_EXTENSIONS, type CodeKnownState, type CodeLanguage } from "../../types/code.js";
import type { RelativePath, WorktreeId } from "../../types/index.js";
import type { CodeStore } from "../store/index.js";
import { checkKey } from "./judge.js";

/*
 * D2: each stored check's body hash in the work set, from the count of the
 * blob its state was judged on. Never from the files row's blob: a count the
 * pass skipped or failed leaves that row at a blob no state was judged on.
 */

/** Each path's language in its files row, read before the pass writes the rows. */
export function languagesOf(
  store: CodeStore,
  worktreeId: WorktreeId,
  paths: readonly RelativePath[],
): Map<RelativePath, CodeLanguage> {
  return new Map(store.files.list(worktreeId, paths).map((f) => [f.path, f.language]));
}

/**
 * The body hash of each of `states`, by `checkKey`. A path with no row,
 * gone while its removals waited (row 015-52), is read in the language of
 * its extension.
 */
export function bodiesOf(
  store: CodeStore,
  states: readonly CodeKnownState[],
  languages: ReadonlyMap<RelativePath, CodeLanguage>,
  counterVersion: number,
): Map<string, string> {
  const bodies = new Map<string, string>();
  const read = new Set<string>();
  for (const state of states) {
    const { path } = state.check;
    const language = languages.get(path) ?? CODE_EXTENSIONS[extname(path)];
    if (language === undefined || read.has(`${path}\0${state.blob}`)) continue;
    read.add(`${path}\0${state.blob}`);
    const count = store.counts.get(state.blob, language, counterVersion);
    for (const fn of count?.functions ?? []) bodies.set(checkKey({ path, ...fn }), fn.bodyHash);
  }
  return bodies;
}

/** `bodiesOf` every complexity state of `paths`. */
export function oldBodies(
  store: CodeStore,
  worktreeId: WorktreeId,
  paths: readonly RelativePath[],
  counterVersion: number,
): Map<string, string> {
  const states = store.states.list(worktreeId, { measure: "complexity", paths });
  return bodiesOf(store, states, languagesOf(store, worktreeId, paths), counterVersion);
}
