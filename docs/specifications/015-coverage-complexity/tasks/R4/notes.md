# R4 notes: repair of review 0.1.295 B1, the import rewrite (015-29)

Worker 614996d3, 2026-10-24. From `5e18ed2b0` (`int/015d-r1`). Brief: `tasks/wave-2.md` R4. Finding: `reviews/0.1.295.md` B1.

## Seam map

| Piece | Where | Test |
|---|---|---|
| The parse, once or twice | `parseTsx` in `src/core/code/count/parser.ts`, called by `withCodeTree` for TSX only; it replaces the old `tsxInput` | `test/code/count/type-import.test.ts` |
| The candidate finder | `TYPE_IMPORT`, the same regex, now with one capture group around the quoted literal | the same file |
| The acceptance check | `isImportSyntax` and `spans` in `parser.ts` | the same file, the B1 block |
| The rule, documented | `src/core/code/count/README.md`, "Gaps of 0.23.2" | |

## The rule as built

1. The NUL replacement, as before. Then one parse of that text.
2. With no `import` in the text, that tree is the result: one parse, as before.
3. Each regex match is a candidate. It is rewritten only when, in the first tree:
   - the smallest node over the six `import` characters is an `import` node with exactly that range;
   - the smallest node over the quoted literal is a `string` node with exactly that range.
4. When no candidate is accepted, the first tree is the result. Otherwise the first tree is freed and the rewritten text is parsed. The rewrite is still underscores of the same length, so every offset holds. Names and body hashes still read the file's own text. `COUNTER_VERSION` stays 3 (never released).

In each B1 form the smallest node over `import` is `string_fragment`, `comment` or `regex_pattern`; in JSX text it is `jsx_text`. In the misparses the rewrite is for (`f<typeof import("x")>()`, `f<import("x").T>()`, and cezar's no-semicolon `composer.test.tsx`, whose first tree is one `ERROR`), the first tree still has the `import` node and the `string` node at the match's ranges. Probe output, 2026-10-24, shipped WASM.

**Either check alone rejects every form found.** I could not write valid code where one check passes and the other fails. `import(` is followed only by spaces or tabs and then the quote, and no token that can hold `import(` (string, comment, template, regex, JSX text) ends at `(`. So no test tells the two checks apart. Both stay, as the brief asks: the string check guards a tree whose error recovery lexes differently.

## Tests, red first

`test/code/count/type-import.test.ts`, block "`import(…)` text across two tokens (review 0.1.295 B1)". Each form expects `errors: []` and `[["hidden", 2]]`:

| Form | Text | At `5e18ed2b0` |
|---|---|---|
| two strings (the review's reproduction) | `const s = "typeof import('"; function hidden(a) { return a ? 1 : 2; }; const t = "')";` | no function, no error |
| two comments | `/* typeof import(' */ function hidden(a) { return a ? 1 : 2 } /* ') */` | no function, no error |
| a string in a template's substitution, then the template's text | ``const s = `${"typeof import('" + (function hidden(a) { return a ? 1 : 2; })()}')`;`` | no function, one error over the line |
| two regular expressions | `const r = /typeof import('|x)/; function hidden(a) { return a ? 1 : 2; } const u = /(')/;` | no function, no error |

All four failed at `5e18ed2b0` (Squeal, revision 2 and 3: 4 FAIL) and pass with the fix (revision 4: FAIL -> PASS). ESLint 10.13.0 `complexity` on `@typescript-eslint/parser` 8.72.0 (the researcher's scratch install in `/tmp/tir-015-25/js`) reports `hidden` at 2 in all four.

Choices the brief left open:

- The two-comment form names its function `hidden`, not `f`, so the four forms share one assertion.
- **The template form.** A match cannot start in a template's text and leave it: the literal excludes `$` and the backtick. It can leave a substitution, because `}` is allowed. So the form starts in a string inside `${…}` and ends in the template's text. A form with two templates, `` `typeof import('` `` and `` `')` ``, is not a regex match, so it was never at risk.
- The regex form uses `/typeof import('|x)/` and `/(')/`, two valid regular expressions.

The two type-import fixtures and the quoted-key test pass unchanged.

## The comparison

Every git-listed JS and TS file outside `docs/`, `fixtures/` and `dist/`, counted by `5e18ed2b0`'s counter (`git archive 5e18ed2b0 src`) and by this row's. Fields compared per function: name, occurrence, CC, start line, start column and body hash; and each file's error ranges.

| Tree | Files | Functions (`5e18ed2b0`, R4) | Files with errors (`5e18ed2b0`, R4) | Files changed |
|---|---|---|---|---|
| squeal at `69927c2b5` (`5e18ed2b0` plus this row's two files) | 1,994 | 31,340, 31,340 | 0, 0 | 0 |
| cezar at `e2882a245` (read only) | 1,924 | 57,014, 57,014 | 0, 0 | 0 |

The squeal file set is 1,994, not 015-29's 1,972: the tree has grown since `5b7c15914`.

The candidates the regex finds:

| Tree | Files with a candidate | Parsed twice | Candidates | Accepted | Rejected |
|---|---|---|---|---|---|
| squeal | 21 | 19 | 55 | 34 | 21: 4 in comments, 17 in strings, all in `parser.ts` and `type-import.test.ts` |
| cezar | 72 | 72 | 93 | 93 | 0 |

`5e18ed2b0`'s counter rewrites all 21 rejected sites, in this repository's own comments and strings; 3 of them are this row's new tests. That changed no count, because each of these matches stays inside one token.

## Cost

The second parse is the cost, only in a file with an accepted candidate. cezar's 72 such files, median of five passes per process, five alternated pairs, one-minute load 27 to 36 on 24 CPUs:

| Pair | `5e18ed2b0` ms | R4 ms |
|---|---|---|
| 1 | 797 | 1,331 |
| 2 | 797 | 1,171 |
| 3 | 605 | 916 |
| 4 | 562 | 851 |
| 5 | 588 | 834 |

About +4 ms per file with a rewrite, +40 to 65% on those files. Over all of cezar's 1,924 files that is about 0.3 s on about 7 s. In the daemon a blob is counted once. Files with no `import` text, and files whose candidates are all rejected, parse once, as before.

Not taken: an incremental second parse (`tree.edit` and `parser.parse(rewritten, tree)`). It would be cheaper, but it reuses nodes of a tree that holds the misparse's `ERROR`. A fresh parse gives the tree a plain parse of the rewritten text gives.

## Residue

- The probes are in the task's scratch folder, not committed: `compare.mjs` (the per-file count, JSON lines), `diff.mjs`, `sites.ts` (the candidate table), `cost.mjs`, `eslint.cjs`. `compare.mjs` is 015-23's probe, extended with the fields above.
- `countTree` (`walk.ts`) stays at CC 24. The new functions, by the counter: `parseTsx` 3, its `replace` callback 2, `isImportSyntax` 2, `spans` 4.

## Verification

At `9ca216eb7`: `npm run lint` (2,018 files, no fixes) and `npm run typecheck` pass. `squeal run --all --wait`, checkpoint `8a27da45` at revision 7, exit 1: 4 known failures, all the bundle-drift tests (`coverage/provider.mjs` is 015-11's new bundle file and this tree has no build commit); 8,404 tests passed and 7 skipped in 1,038 test files. No bundle was built and the version was not raised.
