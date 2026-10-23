import type { FocusedFile, TestFileRef } from "../core/types/index.js";

/*
 * A focused run's texts (spec 011 C14 as amended 2026-10-23, row 011-135):
 * the rule the runner adapters share, kept out of `src/core/` so that no
 * core bundle the key-format alarm compares holds it (011 C3).
 */

/**
 * Whether a focused run's texts select a check (spec 011 C14, row
 * 011-135): its full name, the runner's own without Squeal's duplicate-line
 * suffix (001 D4), holds one of them, literally and with case.
 */
export function holdsCheckText(fullName: string, texts: readonly string[]): boolean {
  return texts.some((text) => fullName.includes(text));
}

/**
 * The texts `checks` gives `testFile`, its entries matched by project and
 * path and joined; `null` when the file runs whole.
 */
export function focusedTexts(
  checks: readonly FocusedFile[] | undefined,
  testFile: TestFileRef,
): readonly string[] | null {
  const own = (checks ?? []).filter(
    (entry) => entry.testFile.project === testFile.project && entry.testFile.path === testFile.path,
  );
  return own.length === 0 ? null : [...new Set(own.flatMap((entry) => entry.texts))];
}

/**
 * The name filter a runner is given for `texts` (013 V4, 003 D5): each text
 * escaped, each ` > ` in it matching ` > ` or a space, since Vitest 5 joins a
 * full name with ` > ` and Vitest 4 and node:test with a space, the texts
 * joined by `|`; no text matches nothing. It can select more checks than
 * `holdsCheckText` does, so the adapter keeps only the checks that hold a text.
 */
export function checkTextPattern(texts: readonly string[]): string {
  if (texts.length === 0) return "(?!)";
  const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return texts.map((text) => literal(text).split(" > ").join("(?: > | )")).join("|");
}
