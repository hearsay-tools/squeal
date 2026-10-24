# 011-173 notes: a focused text's ` > ` matches only the separator on Vitest 5

Row 011-173, wave 30 W6, from review 0.1.278 N1. Worker notes for the coordinator and the next worker.

## What changed

- `src/runners/focus.ts`: `checkTextPattern(texts, rule)` takes a `SeparatorRule`. `separator` escapes each text and joins the texts with `|`, so a ` > ` matches ` > ` alone. `separator-or-space`, the default, is today's pattern: each ` > ` matches ` > ` or a space.
- `src/runners/vitest/name-pattern.ts` (new): `namePattern(texts, version)` picks the rule from the major of `Vitest.version`: 5 and later get `separator`; 4, and a version that does not read as a number, get `separator-or-space`.
- `src/runners/vitest/adapter.ts`: the focused specification's `testNamePattern` is `namePattern(texts, vitest.version)`.
- The post-filter (`src/runners/vitest/reporter.ts`, `holdsCheckText` in `testCase`) is unchanged, as N1 asks. On Vitest 5 the pattern and the post-filter now select the same checks; on Vitest 4 the post-filter still drops what the pattern lets run.

## Seam map

- Vitest 5.0.3 matches `testNamePattern` against `fullTestName` (`node_modules/vitest/dist/task-utils.js`, `interpretTaskModes`: `t.fullTestName.match(namePattern)`). `fullTestName` is `createTaskName([suite.fullTestName, name])`, joined by ` > `, without the file name. So a literal escaped text selects exactly the checks whose `TestCase.fullName` holds it, the same as `holdsCheckText`.
- `Vitest.version` is an instance property (`readonly version: string`), present on the instance the adapter already holds in `run`.
- node:test has no focused run yet: `createNodeTestAdapter` sets no `focuses`, and nothing in `src/runners/node-test/` calls `checkTextPattern`. Its future caller gets the default, `separator-or-space`, which 003 D5 needs since `--test-name-pattern` reads names joined by a space.
- The parked node:test focus change (commit 8991f3bcf, row 011-144, which 003 D5 says row 011-156 lands) calls `checkTextPattern(texts)` with no rule, so it keeps today's pattern as is. It also adds 18 lines to `test/runners/vitest/focused.test.ts`; whoever lands it rebases over this row's change to that file.
- The key-format alarm: `focus.ts` and `name-pattern.ts` are in the Vitest component's bundle (`test/keys/validity/entries/vitest.ts` exports `adapter.ts`, which imports both). The corpus case with `checks` (`test/keys/validity/cases/adapter/vitest.ts`, texts `new` and `parity > inner`) runs the changed lines; its rows agree with 0.1.288's. `test/keys/key-format.test.ts` passed at revision 11 with the change: no version raise asked.

## Tests (done-when)

| Done-when line | Test |
| --- | --- |
| On Vitest 5 a text with ` > ` starts no check whose full name only matches with a space | `test/runners/vitest/focused.test.ts` "does not run a check whose full name matches a text only with a space": a real run on the installed Vitest 5.0.3; each body appends to `ran.txt`; only `selected` is written. With the old pattern forced, it fails: `expected 'selected\noutside\n' to be 'selected\n'`. Also `test/runners/vitest/name-pattern.test.ts`, case 1 (5.0.3, a 5.1 beta, 6.0.0). |
| Vitest 4 keeps today's pattern | `test/runners/vitest/name-pattern.test.ts`, case 2 (4.1.10, a 4.0 beta, an empty version). No real Vitest 4 run: no Vitest 4 is installed here (cezarion runs 4.1.10 under Squeal, `tasks/011-135/design.md`, "Limits and open questions"). |
| node:test keeps today's pattern | `test/runners/check-text.test.ts` "matches each ` > ` as ` > ` or a space by default": the default its future caller gets. |

The case "drops a check the pattern lets through that holds no text" is replaced by the marker case, which proves more: it fails if the body runs, not only if its result is reported.

## Decisions the spec did not settle

1. A version that does not read as a number gets the loose rule. It runs a superset and the post-filter keeps the report right, so the cost is extra executions, never a missing check.
2. The rule is a parameter with a default (`separator-or-space`), not a required argument, so node:test's future caller and today's tests keep today's pattern unchanged.

## Spec lines proposed (coordinator's to write)

013 V4, the 2026-10-23 amendment's pattern sentence, replaced by:

> a run given texts for a file (011 C14, `RunOptions.checks`) creates that file's specification with `testNamePattern`: each text escaped, the texts joined by `|`. Vitest 5 and later match the full name joined by ` > `, so there each ` > ` in a text matches ` > ` alone and the pattern runs exactly the checks whose full name holds a text. Vitest 4 matches it joined by a space, so there, and on a version that does not read as a number, each ` > ` matches ` > ` or a space (amended 2026-10-24, row 011-173, review 0.1.278 N1).

011 C14, after "through the runner's own filter":

> A filter that reads the full name joined by a space (Vitest 4, node:test) can run more checks than hold a text; the adapter reports only those that hold one (row 011-173).

Status line for `011-core/status.md`:

> 2026-10-24, 011-173 (review 0.1.278 N1): on Vitest 5 and later a focused file's pattern reads each ` > ` of a text as ` > ` alone, so it runs only the checks whose full name holds a text; Vitest 4 and node:test keep ` > ` or a space. Fewer checks run in a focused Vitest 5 run whose text matched another check only with a space. 013 V4 and C14 amended. Key format and adapter versions unchanged: the alarm's Vitest case agrees with 0.1.288.
