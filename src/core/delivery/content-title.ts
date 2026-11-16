import { lintTitleWords } from "../lint/surface/format.js";
import { plural } from "../text.js";
import type { Delta } from "../types/delivery.js";
import { codeTitleWords } from "./code-format.js";
import { groupKind } from "./slow-told.js";

/**
 * Row 005-91 (c): a title's words for the lines a delivery with no changed check, liveness or
 * hold carries: the edit lines (001-224; row 005-93's late and caught up), the owed counts (011-205), each group line
 * (019-16; its kind, as `groupKind` tells it), the slow-tier line, a lint line with no change
 * to count (017 D8) and the commit line.
 */
export function contentWords(delta: Delta): string[] {
  const { sawEdit, header } = delta;
  const words: string[] = [];
  // Row 005-93: the late and caught-up notices title their delivery.
  if (delta.editsLate !== undefined) words.push("results for your edits are late");
  if (delta.caughtUp !== undefined) words.push("caught up");
  if (sawEdit !== undefined) {
    // No test group at `edit`: the files wait for their groups' moments, so none was queued.
    const did = header.noTestsAtEdit === true ? "affects" : "queued";
    words.push(`your edit ${did} ${plural(sawEdit.queued, "test file")}`);
  }
  if (delta.countsOwed !== undefined) words.push("the counts after the listing");
  if (delta.groupTiersChanged !== undefined) {
    for (const group of header.groupTiers ?? []) {
      if (!delta.groupTiersChanged.includes(group.name)) continue;
      const kind = groupKind(group);
      if (kind !== "current") words.push(`${group.name} group ${kind}`);
    }
  }
  if (delta.slowTierChanged === true && header.slowTier !== undefined) {
    words.push(`slow tier ${groupKind(header.slowTier)}`);
  }
  words.push(...codeWords(delta.code), ...lintWords(delta.lint));
  const commit = delta.commitChanged === true ? header.commitLine : undefined;
  if (commit !== undefined) {
    words.push(`commit ${/^Commit (\S+?):/.exec(commit.text)?.[1] ?? commit.commit.slice(0, 7)}`);
  }
  return words;
}

/** A lint line with no change to count: the summary after a keying, or a reason lint is unknown or off. */
function lintWords(lint: Delta["lint"]): string[] {
  if (lint === undefined || lintTitleWords(lint) !== null) return [];
  return [
    ...(lint.summary === undefined
      ? []
      : [lint.summary.reason === "config" ? "lint config changed" : "lint summary"]),
    ...(lint.failed === undefined ? [] : ["lint unknown"]),
    ...(lint.off === undefined ? [] : ["lint off"]),
  ];
}

/**
 * Code lines with no function change to count (review 0.1.527, B2): a recount, a threshold
 * or coverage change, a file too big to count. Their summary lines follow the blocks.
 */
function codeWords(code: Delta["code"]): string[] {
  if (code === undefined || codeTitleWords(code) !== null) return [];
  const too = code.tooBig?.length ?? 0;
  return [
    ...(code.recount === undefined
      ? []
      : [
          code.recount.reason === "threshold"
            ? "complexity threshold changed"
            : "complexity counted",
        ]),
    ...(code.crapRecount === undefined ? [] : ["CRAP threshold changed"]),
    ...(code.coverageChange === undefined ? [] : ["coverage checks changed"]),
    ...(too === 0 ? [] : [`${plural(too, "file")} too big to count`]),
  ];
}
