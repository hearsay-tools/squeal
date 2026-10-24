# R7 notes: a git body after an own edit (review 0.1.299 B1)

Worker f0ed5308, 2026-10-25. Brief: `tasks/wave-3.md` "R7". On `cez/f0ed5308` after 32cc16d06 (015-40).

## The defect

015-40's coverage step marks a `crap` or `uncovered` edit from the complexity pass's last edit of the function, when that edit came after the measure's last judgement. The complexity pass keeps an own edit's mark when git later replaces the body (it marks no edit for git's body, and clears none). So an own edit whose coverage was still pending qualified the judgement of git's body: a `STILL FAIL` "after the edit" for a body the session did not write.

## As built

- `src/core/code/crap/brought.ts`, new. `broughtByGit`: each file git changed, with the last revision, from the pulled record (015-38, `readPulled`) and from `CoverageSummary.brought`. The summary keeps an entry until the file is judged at its current blob (`keepUnjudged`), because an own edit to another function of the file after the pull takes the file out of the pulled record while the function keeps git's body.
- `crap/step.ts` `writeJudgement`: a complexity edit qualifies only when its revision is after the file's `brought` revision. The edit's own revision still goes to the mark, for the session's bound.
- The step runs after every complexity pass with a revision (`createCodePass`), so it sees a pull's pulled record before a later own edit removes it.
- No change to delivery, git's FAIL or recovery rules, the pass, or any complexity output.

## Tests

`test/code/crap/still-fail-pulled.test.ts`, the main store's revisions mirrored so the session counts from revision 1:

- B1's four steps: no line for git's body; then an own edit to that body tells both `STILL FAIL` lines. Red before the fix with both lines.
- An own edit pending, the pull, then an own edit to another function of the file: nothing for the git body of `cold`, and `hot`'s own `STILL FAIL uncovered`. Red before the fix.
- Control: an own edit whose record comes after two unrelated revisions (one committed) still tells both lines. Green before and after.

## Limits

- Provenance is per file, as 015-38's: an own edit to function A, then a pull that changes only function B of the same file, leaves A's pending edit unqualified. The miss is a quiet one: no line, never a false one.
- If one pass covers both the pull and a later own edit to the file, the complexity pass treats the file as the session's (015-19's per-pass rule), and so does this step.

## Type changes

`CoverageSummary.brought?` (additive).
