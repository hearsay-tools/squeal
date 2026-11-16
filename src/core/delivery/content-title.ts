import { lintTitleWords } from "../lint/surface/format.js";
import { plural } from "../text.js";
import type { Delta } from "../types/delivery.js";
import { groupKind } from "./slow-told.js";

/**
 * Row 005-91 (c): a title's words for the lines a delivery with no changed check, liveness or
 * hold carries: the edit lines (001-223, 001-224), the owed counts (011-205), each group line
 * (019-16; its kind, as `groupKind` tells it), the slow-tier line, a lint line with no change
 * to count (017 D8) and the commit line.
 */
export function contentWords(delta: Delta): string[] {
  const { sawEdit, editsSettled, header } = delta;
  const words: string[] = [];
  if (editsSettled !== undefined) {
    words.push(`your edits' test files ${editsSettled.unknown === 0 ? "are current" : "finished"}`);
  } else if (sawEdit !== undefined) {
    const did = header.noTestsAtEdit === true ? "re-keyed" : "queued";
    words.push(`your edit ${did} ${plural(sawEdit.queued, "test file")}`);
  }
  if (delta.countsOwed !== undefined) words.push("the counts after the listing");
  if (delta.groupTiersChanged === true) {
    for (const group of header.groupTiers ?? []) {
      const kind = groupKind(group);
      if (kind !== "current") words.push(`${group.name} group ${kind}`);
    }
  }
  if (delta.slowTierChanged === true && header.slowTier !== undefined) {
    words.push(`slow tier ${groupKind(header.slowTier)}`);
  }
  // A lint line with no change to count: the summary after a keying, or a reason lint is unknown or off.
  const lint = delta.lint;
  if (lint !== undefined && lintTitleWords(lint) === null) {
    if (lint.summary !== undefined) {
      words.push(lint.summary.reason === "config" ? "lint config changed" : "lint summary");
    }
    if (lint.failed !== undefined) words.push("lint unknown");
    if (lint.off !== undefined) words.push("lint off");
  }
  const commit = delta.commitChanged === true ? header.commitLine : undefined;
  if (commit !== undefined) {
    words.push(`commit ${/^Commit (\S+?):/.exec(commit.text)?.[1] ?? commit.commit.slice(0, 7)}`);
  }
  return words;
}
