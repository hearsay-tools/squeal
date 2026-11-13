# Wave 84: row 011-330 (one rule per report field in the report merge) and review 0.1.473 S1

Coordinator 5dc06308, 2026-11-13. The human approved rows 011-329 and 011-330 ("Approve, land, start"; design session 238ba474, architecture review card 8). 011-329 landed as 0.1.473 (`reviews/0.1.473.md` PASS). This wave is 011-330 (W1) and that review's should-fix S1 (W2), in parallel: their files are disjoint. One candidate covers both.

Host policy, as in `wave-76.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no probe or harness session under the real `HOME`. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version.

## W1: row 011-330

Use /worker. Shape: slice, test first, one commit per step.

Outcome: `merge` takes each `RunReport` field from one rule record typed over every field, so a field with no rule fails the typecheck, and every merged report is the same as today's.

Read: board row 011-330; `research/runner-traits.md` (decision 2, the call "The report merge", row 2's done-when); `GLOSSARY.md`, "Report merge"; the losses it guards against: `59d1ca149`, review `reviews/0.1.280.md` B1, review `021-remote-store-and-execution/reviews/0.1.457.md` B3.

Seam and lead: `merge` at `src/core/daemon/composite-runner.ts:216`. First edit: the table test, run against today's `merge` and passing before any refactor. One row per field over one, two and three parts, and two parts each with a setup failure. Then the rule record (it may live in a new file beside the composite, no barrel), and `merge` built from it.

Rules:

- **Presence is part of a rule.** Today `fileDurations`, `observed` and `reads` are present when any part has them, even empty; `environmentObserved`, `skippedFiles`, `withheld`, `focused` and `startedProjects` only when non-empty; `startupFailure` is the first part's. The table compares whole reports with `toStrictEqual`, so a key present or absent is a cell.
- **One decision path** (review `0.1.452.md` B1). The table calls `merge`, never a copy of the rules.
- **The remote lane's code does not change.** `merge` stays exported from `composite-runner.ts`; the split tier's own second-failure handling in `remote/lane.ts` stays.

Owns: `merge`, `Part` and `SEVERITY` in `composite-runner.ts`, a new rules file beside it, the table test (`test/daemon/report-merge.test.ts` or as you name it), the merge cases you delete from `test/daemon/composite-runner.test.ts` (about `:229-339`) and from `test/runner-host/remote/`.

Leave alone: every other line of `composite-runner.ts`; `src/core/runner-host/**` (card 10 follows this lane); `src/core/types/runner.ts` (`RunReport`'s shape is out of scope); W2's files.

If a behaviour cannot be kept, stop and ask the coordinator; do not widen the row.

Done when: the row's done-when holds; your notes show the typecheck error a scratch `RunReport` field gives (not committed); the composite's and the remote lane's tests pass unchanged, less the merge cases the table replaced, each named in the notes with its table row; `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts` pass with no raise; lint and typecheck pass; affected results read through `squeal status --wait 60000 <paths>`. Notes in `tasks/011-330/notes.md`. Your final message lists decisions the record did not settle and type changes.

## W2: review 0.1.473 S1, the runner traits holder table

Use /worker. Shape: finish, tests only.

Outcome: the holder table of row 011-329 also covers the in-process pytest adapter and the live node:test and pytest recovering runners.

Read: `reviews/0.1.473.md` S1 and N1; `tasks/011-329/notes.md`, "The table"; `research/runner-traits.md`, "Tests: replace, don't layer".

Seam: `test/daemon/runner-traits-holders.test.ts` (in-process rows about `:58`, recovering rows about `:131`) and `test/daemon/runner-traits-fixture.ts`. Add: in-process pytest with no batch size and with 2, at `runner.tierSize` 4 then 6, all eight columns; node:test and pytest recovering runners through `open`, an idle close and a replacement, through the fixture seams that exist. Keep them in the existing table; no new forwarding suite.

Owns: those two test files. Leave alone: every product file and W1's files.

If a new row shows an answer that differs from the base before 011-329 (`73abdb9e1`) in a way N1 does not name, stop and report it to the coordinator; do not change product code.

Done when: the new rows pass; the table's other rows are unchanged; lint and typecheck pass; affected results read through `squeal status --wait 60000 <paths>`. Notes: a short "W2" section appended to `tasks/011-329/notes.md` naming each new row.

## R1: review of cand/0.1.477

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.477` at `efafa9f32d5956483b2dc9b58583b80a068e7c1b`; range `371cc8f8c..efafa9f32`: W1's three commits of e645ac81 (`8c11ce0ff..07e2a6d7a`), W2's two commits of e8ca62ce (`499797ac5..116ea33b0`), all cherry-picked, then the 0.1.477 version raise and bundles. The behaviour to compare against is `371cc8f8c`. Read: board row 011-330, `research/runner-traits.md` (decision 2, "The report merge", row 2's done-when), `tasks/011-330/notes.md`, the "W2" section of `tasks/011-329/notes.md`, `reviews/0.1.473.md` S1 and N1, this file's W1 and W2. Candidate CI: the run on `efafa9f32`.

Check, each as proven, plausible or unverified:

1. **Every merged report is the same** as at `371cc8f8c`, for the composite and the remote lane: each field's value, whether an optional key is present or absent (empty included), the key order of the merged object, the failure text and its order, the first setup failure kept, `startedProjects` once each and sorted.
2. **A field with no rule fails the typecheck**: `MergeRules` over every `RunReport` key, and the `Object.fromEntries` build with its one cast in `merge`. Can a forgotten or misplaced rule still pass the typecheck and the table, and does the cast hide one?
3. **One decision path** (review `0.1.452.md` B1): the table calls `merge` as the composite and the remote lane do, never a copy of the rules.
4. **Replace, don't layer.** Each of the four deleted composite cases maps to table rows that prove the same thing; no remote lane case was deleted, by the worker's call (notes).
5. **Scope.** In `composite-runner.ts` only `merge`, `Part` and `SEVERITY` moved; nothing under `src/core/runner-host/` changed; `RunReport`'s shape did not change.
6. **W2 (review 0.1.473 S1).** The new holder rows cover in-process pytest (no batch size and 2) and node:test and pytest recovering runners in a real host through creation, idle close and replacement; each answer matches the base, or differs only as N1 names; no product file changed. Judge the worker's choice to leave out a hosted pytest row with no batch size.

`test/version-sensitive.test.ts` passed on the coordinator's tree at the candidate (7 of 7); lint, typecheck and `check:version` are clean; the build shows no drift. `test/keys/key-format.test.ts` runs on the coordinator's tree and in CI.

Host policy: no local full suite, no `squeal run --all`, no `pnpm run build`; targeted runs with `env -u PLUGIN_ROOT -u PLUGIN_DATA`; affected results through `squeal status --wait 60000 <paths>`. Write `reviews/0.1.477.md` and commit it on your branch.
