# 015-16 notes: repair of review 0.1.283 B1, B3 and B4

Worker fd003b1e, 2026-10-24. From `cand/0.1.283` at de9deb5bc. The sibling row 015-17 repairs B2 and B5 on disjoint files.

## Seam map

| Blocker | Seam | Regression |
|---|---|---|
| B1, corruption past a successful open | `withCode` in `src/core/delivery/code-source.ts` | `test/code/delivery/corrupt.test.ts` |
| B3, a missing token's zero-width error | `overlaps` in `src/core/code/pass/judge.ts` | `test/code/pass/judge-errors.test.ts` |
| B4, parse errors outside every function | `notJudged` in `src/cli/code-report.ts` | `test/code/delivery/code-errors.test.ts` |

The callers of `withCode` (`code-status.ts`, `code-deliver.ts`, `stop-code.ts`, `src/cli/code.ts`) did not change: each already treats `null` as "no code part". Only the daemon's pass opens the code store outside `withCode`, and it is not a hook.

## The rules as built

- **B1.** `withCode` returns `null` for every error thrown in the code operation, not only a busy one. The test channel then reads as it does with the policy off. A write in a code transaction rolls back with it. No integrity scan runs. `squeal code` then prints "The code store cannot be read." and exits 1, as before for an open failure.
- **B3.** A zero-width error range is a point P. P belongs to a function F when `F.start < P <= F.end`. A non-zero-width error keeps the end-exclusive overlap.
- **B4.** A file is `parse-error` when its stored count has `errors`. `unknown` is the number of its `unknown` function states, `0` included. A file with no stored count is `not-counted`. That test replaces the `files.uncounted` query in this function and gives the same set.

## What the real parser does at end of file

These come from `countFile` probes. The tests pin the cases marked "pinned".

| Input | Error | Function range | Result |
|---|---|---|---|
| `function f(x) { if (x) return 1;` | 1:33 to 1:33, zero width | f 1:1 to 1:33 | f unknown (pinned) |
| the same, with two missing braces and trailing spaces | two errors at f's end | f ends at its last token, not at EOF | f unknown (pinned) |
| `class A { m(x) { if (x) return 1; }` | at A.m's end, zero width | A.m ends at its own `}` | A.m unknown, though its body is complete (pinned) |
| `function f(x) { if (x) { return 1; }\nfunction g() …` | at the end of f and of f.g | g parses nested in f | both unknown |
| a missing `)` or `]` after a callback, an object's missing `}` | non-zero width, from column 1 | inside | unknown already before the fix (pinned) |
| Python `return g(x` at EOF | non-zero width | inside | unknown already (pinned) |
| Python `if x:` with no block at EOF | none | | judged: the grammar accepts it |
| `return g(x`, `return [x`, `x ? 1 :` in TS | one error over the file | none counted | no function |

## Decisions the spec left open

- **B1, which failures.** All of them, not only SQLite error codes. A damaged row throws `TypeError` from the codec, and the brief says any code-store failure. The cost: a programming error inside a code read is silent in production. Tests still see it, as an assertion that fails on a missing code part.
- **B3, a function that starts at P.** It is not in P, so a healthy function that ends where the broken one starts stays judged. The function whose end P touches is `unknown` even when its own body is complete, as `A.m` above: the parse cannot tell which brace is missing.
- **B4, `unknown: 0`.** It is always set for `parse-error`. `CodeReportFile.unknown` stays optional, so there is no type change. The text line reads `does not parse; 0 functions in its errors not judged`.

## For the next worker

- The bundle-drift tests fail until the coordinator rebuilds `plugins/*/dist`.
- A function that goes from `unknown` back to `fail` gets `changedAt` set to that revision (`judge`). It is not a transition, but it moves the function's place in `squeal code`'s "newest first". This repair did not change it.
