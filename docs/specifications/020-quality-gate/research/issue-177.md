# Issue #177: `squeal code` omits changed functions without a reason

Researcher, 2026-11-11. Squeal 0.1.430 (`1ac649d40`), Node 24.22.1, 24 vCPUs.
One-minute load before the live run: 15.53 (under 24). Probe:
`probes/issue-177/fixture.sh`, output `probes/issue-177/run.txt`.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does `squeal code --base` leave out helpers moved verbatim to a new module? | Yes, by design. D2.3 "Moved" is not a change. A rename with the same parameters and body is also left out. | verified by experiment (0.1.430); read in spec 020 D2 |
| 2 | Does it leave out trivial changed test callbacks? | Yes, when the callback's own text (parameters and body, whitespace removed) is unchanged or already exists at the base in any changed path: a title-only change, a reindent, an edit into a sibling's body, a new callback that copies an existing one. A callback whose text is new is reported. | verified by experiment (0.1.430); read in source `src/core/code/gate/changed.ts:108` |
| 3 | Default text output against `--base --json` | Text: the verdict line with counts, then only rows that are not `pass`. With every function passing it prints the verdict line and the JSON hint only. JSON: one row per judged function, `pass` included, and every changed path in `head.paths`. Neither names a left-out function or gives a count of them. | verified by experiment (0.1.430); read in source `src/cli/code-gate-text.ts:163` |
| 4 | Design exclusion or defect? | Every omission in the fixture follows spec 020 D2.3. No defect against the current spec was reproduced. The gap #177 names is a reporting gap the spec does not ask for: D7 lists "per changed function" only, and D1's text lists only non-pass rows. | inferred from 1–3 |
| 5 | Which command made "17 of 21"? | Not determined, because the issue did not record the command. See Open questions. | — |

## Findings

**Fixture.** Base commit: `src/old.ts` with `clamp`, `sign`, `oldName`, `main`; `test/old.test.ts` with one `describe` and four `it` callbacks. Working tree: `clamp` and `sign` moved verbatim to the new `src/helpers.ts`; `oldName` renamed `newName` there, same body; `main` edited; in the test, "clamps" retitled only, "signs" reindented, "keeps" edited into the body of "clamps", a new empty "noop two" (same text as "noop"), and a new "zero" callback with new text. A line-based count, which marks a function changed when a diff hunk touches it, sees 10 changed functions.

**Commands and results** (`run.txt`):

```
node plugins/claude-code/dist/cli/squeal.mjs code --base HEAD          # exit 0
Code gate: pass. 3 changed functions against HEAD (merge base 8b1af5bc): 3 pass.
JSON report: squeal code --base HEAD --json

node plugins/claude-code/dist/cli/squeal.mjs code --base HEAD --json   # exit 0
verdict pass, counts {"pass":3,...}; functions: src/old.ts main (edited),
test/old.test.ts <describe> (edited), <describe>.<it> occurrence 5 (added, "zero")
```

Reported 3 of 10. Left out, with the D2 rule that removes each:

| Function | Change | Rule |
|---|---|---|
| `clamp`, `sign` | moved verbatim to a new module | Moved |
| `newName` | renamed, same body | Moved (the hash starts at the parameters, so the name is not in it) |
| "clamps" callback | title changed; the title is outside the function | unchanged body |
| "signs" callback | reindented | unchanged (whitespace is removed before hashing) |
| "keeps" callback | real edit: `main(4)` → `main(12)`, `4` → `9` | Shifted/Moved: its new text equals the base "clamps" callback |
| "noop two" callback | added, empty | Moved: same text as the base "noop" |

**The rule in code.** `changedFunctions` drops every head function whose body hash any base function of any counted changed path has (`changed.ts:108`, `if (atBase.has(count.bodyHash)) continue;`). The hash is SHA-1 of the text from the parameters to the end, with all whitespace removed (`count/walk.ts:181`, `count/typescript.ts:67`). This is spec D2.3's "Moved" rule as written. It is wider than D2.3's "Shifted" motive (a position number moved), so it also drops an edit or an addition whose text copies an existing function, as "keeps" and "noop two" show.

**Design exclusions.** Moved, renamed and reindented functions, and retitled test callbacks, are not changes under goal 2 and D2.3. The human accepted "changed JS/TS functions ... are checked" in #167, and the spec defines "changed" by body hash. Leaving them out is intended.

**Where it can matter.** A copied body has the same CC as the original, so the complexity check is safe. Its coverage is not proven at its new place. CRAP at 0% coverage is CC² + CC, so a left-out function with CC ≤ 5 can never exceed CRAP 30 (CC 5 gives 30, equality passes). The issue's worst case, CRAP 12, is CC 3 at 0%. The risk is a copied function with CC ≥ 6, or one in a file no test loads, which would read `incomplete` (`no-loader`) if measured. That case is a consequence of D2.3, not a code defect.

**Reporting.** The issue's real cost is that a reader cannot tell "left out on purpose" from "missed". The text form hides every passing row by design (D1). The JSON form lists only judged functions (D7). Neither has a count or a list of functions left out by D2.3. Adding one is a change to D7 (and perhaps D1), product-facing, for the coordinator and the human.

## Recommendation for Squeal

Treat #177 as a reporting gap, not a selection defect. If the human wants it, amend D7: add to the JSON a list (or at least a count per reason) of head functions a line diff touches that D2.3 left out, each with its reason (`moved`, `unchanged`), and add one count to the text verdict line (for example "7 left out as moved or unchanged"). Keep D2.3's selection as it is. Separately decide whether a function whose text copies another one, but at a new identity, should be measured; that is the one case where an edit with new behaviour ("keeps") is not checked.

## Open questions

1. Which command made "17 of 21"? Without `--base`, `squeal code` reads the daemon store, where 015 D1 never counts test files; that alone would omit test callbacks. The issue gives "Squeal revision 6", a daemon revision. Deciding it needs the command or a re-run of `squeal code --base <parent>` on hearsay-tools/cezarion at `9c5c5791` (PR 3170: `server.ts` −45/+22, new `run-checkout.ts` +64, new `run-checkout.test.ts` +101). Not run: it needs a cezarion install.
2. In PR 3170 the test file is new, so its callbacks can only be left out if their text equals a base function of `server.ts`, the only counted path that exists at the base. Not checked.

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/177 (read with `gh issue view 177 --json`, 2026-11-11).
- PR: https://github.com/hearsay-tools/cezarion/pull/3170 (`gh pr view 3170 --json files`).
- Spec 020 D1, D2, D5, D6, D7; spec 015 D1, D2, D3, D6 (this worktree at `1ac649d40`).
- Source at `1ac649d40`: `src/core/code/gate/changed.ts:40-130`, `src/core/code/count/walk.ts:181`, `src/core/code/count/typescript.ts:67`, `src/cli/code-gate-text.ts:143-180`.
- Probe: `probes/issue-177/fixture.sh`, `probes/issue-177/run.txt`.
