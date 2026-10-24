# 015-23 notes: two parse errors that need not be

Worker 3aad76a7, 2026-10-24. From `main` at 923c5a2e2. Brief: `tasks/wave-1b.md` W4. The sibling rows 015-19, 015-20 and 015-22 work on disjoint files.

## Seam map

| Error | Seam | Regression |
|---|---|---|
| `export type * from` | `grammarGap` in `CountRules` (`src/core/code/count/walk.ts`), read by `isError`; the TS rule in `typescript.ts` | `test/code/count/errors.test.ts` |
| A raw NUL | `withCodeTree` in `src/core/code/count/parser.ts` | the same file |

`COUNTER_VERSION` is 2 (`index.ts`). The two parse-error tests that were in `identity.test.ts` moved to `errors.test.ts`.

## The rules as built

- **No new grammar.** `tree-sitter-typescript` 0.23.2 (2024-11-11) is the latest release on npm and on GitHub. Its master after 0.23.2 has no grammar change. The upstream fixes for `export type *`, pull requests 358 and 360, are open. So the brief's fallback applies: the error rule.
- **`export type *`.** The grammar leaves `type` alone in an `ERROR` that is a child of `export_statement`, followed by `*` (`export type * from`) or `namespace_export` (`export type * as N from`). Only that shape is no error. A comment between `export` and `type` keeps the shape; a comment between `type` and `*` does not, and stays an error. The broken forms `export type *;`, `export type * from;` and `export type * frm 'x';` give other shapes (an `expression_statement`) and stay errors.
- **NUL.** tree-sitter's lexer reads a NUL as the end of the input. The TSX parse gets a space in place of each NUL; a NUL and a space are each one UTF-16 unit, so every range stays. The walk gets the file's own text, so a body hash keeps its NUL (a test proves the hashes differ). A name comes from the parse input, so a NUL in a quoted key's name reads as a space. A stray NUL between tokens, which JS does not allow, now reads as whitespace; it can add no decision point.
- **Python keeps NUL as an error.** CPython refuses a NUL anywhere in a source file ("source code string cannot contain null bytes"), so no Python file that runs holds one, and radon cannot read one.
- **The test texts are inline.** A committed fixture file with a raw NUL is binary to git, so its diff cannot be read in a review. The tests build the text with `\0` escapes.
- **`countTree`** went from 25 to 24, because the error test moved into `isError`. It stays over 20; splitting it is not this row.

## Open point for row 015-25: `typeof import(…)` in a type argument

`importOriginal<typeof import("./x.js")>()` does not parse. The grammar reads `f < typeof import(…) > ()` as comparisons and puts the `()` in an `ERROR` as `formal_parameters`. So the tree is wrong, not only flagged, and a `grammarGap` rule would accept a wrong tree. The coordinator's decision (2026-10-24): leave it here, documented in `src/core/code/count/README.md`; row 015-25 researches a fix (an upstream grammar change or a narrow rewrite before parsing).

My probe after this row's fix, over every git-listed JS and TS file outside `docs/`, `fixtures/` and `dist/`:

| Repository | Files with errors | Of them with `<typeof import(` | Functions in an error range | Of them in those files |
|---|---|---|---|---|
| squeal at `cbded2dd6` | 14 | 14 | 19 | 19 |
| cezar at `03c905a00` | 66 | 65 | 285 | 70 |

The cezar file without `<typeof import(` is `packages/web/src/components/composer/composer.test.tsx`: one error over the whole file (1:1 to 1146:1), 215 functions. I did not look for its cause.

**Not settled.** `lessons.md` says the cezar clone at `03c905a00` had "1 function in a parse error" and the squeal clone had 4 files in parse errors with no function in them. My probe finds far more. Either the dogfood's policy counted fewer files (it counted 944 files in cezar and 1,204 here), or `squeal code`'s summary counts differently from my overlap rule. Row 015-25 should settle that first, against `squeal code` on a clone.

The probe, run with `node_modules/.bin/tsx <probe>.mjs <repository root>` from a scratch directory beside the worktree (it imports the counter by relative path; adjust `COUNTER`):

```js
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const COUNTER = "<worktree>/src/core/code/count/index.js";
const { countFile } = await import(COUNTER);
const root = process.argv[2];
const files = execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter((p) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(p))
  .filter((p) => !p.startsWith("docs/") && !p.includes("fixtures/") && !p.includes("/dist/"));
// `overlaps` as in src/core/code/pass/judge.ts.
const before = (l, c, L, C) => l < L || (l === L && c < C);
const overlaps = (a, b) =>
  b.startLine === b.endLine && b.startColumn === b.endColumn
    ? before(a.startLine, a.startColumn, b.startLine, b.startColumn) &&
      !before(a.endLine, a.endColumn, b.startLine, b.startColumn)
    : before(a.startLine, a.startColumn, b.endLine, b.endColumn) &&
      before(b.startLine, b.startColumn, a.endLine, a.endColumn);
let errFiles = 0, typeofFiles = 0, lost = 0, lostTypeof = 0;
for (const p of files) {
  let text;
  try { text = readFileSync(`${root}/${p}`, "utf8"); } catch { continue; }
  const c = await countFile(text, /\.[cm]?jsx?$/.test(p) ? "javascript" : "typescript");
  if (!c.errors.length) continue;
  errFiles++;
  const t = /<typeof import\(/.test(text);
  if (t) typeofFiles++;
  const n = c.functions.filter((f) => c.errors.some((e) => overlaps(f.range, e))).length;
  lost += n;
  if (t) lostTypeof += n;
  if (!t) console.log("other", p, n);
}
console.log(JSON.stringify({ errFiles, typeofFiles, lost, lostTypeof }));
```
