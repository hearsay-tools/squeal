# Wave 93: rows 011-341 and 011-342

Coordinator fab00745, 2026-11-14. The human's "Rows: Approve, land, start" of 2026-11-14; both rows run after row 011-340, which landed as 0.1.500. One worker takes both, in one candidate.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose. Not yours: the board, `spec.md`, `status.md` (yours: one line in spec 019's `status.md` if 011-341 flips), `plugins/*/dist`, the `package.json` version.

## W1: rows 011-341 and 011-342, a test first for each design difference

Use /worker. Shape: two small slices, each test first. Runner claude, opus, effort medium.

Outcome: a scheduler test shows whether each of the design's differences 1 and 2 happens; where it does, the admission closes it and the pinned table row flips; where it does not, the notes say why and the row records it.

Read: board rows 011-341 and 011-342; `research/admission.md` (Problem, "Differences between the copies", Rows items 2 and 3); `tasks/011-340/notes.md`, "For the next worker"; `src/core/scheduler/admission.ts`.

Order:
1. **011-341.** First edit: a scheduler test with a configured group whose `after` is `[]` and a queued file, where a batch queues runner work after the lane listed its files and before its selection. Does its tier start before the runner work is applied? If yes: `Admission#laneHalt` refuses with `runner-work` after `held`, the row "difference 1, row 011-341" in `admission.test.ts` flips, and you write one dated line in `docs/specifications/019-*/status.md`: D3's "start beside fast work" means beside fast tiers, not before pending runner work. If no: the notes say why, and the table row's name records it.
2. **011-342.** First edit: a test where a configured group's file waits for its slot or the load guard while the re-walk has a chunk left. Is the chunk queued? If yes: `#facts()` reads every lane's waiting activity, the row "difference 2, row 011-342" flips. If no: the notes say why.

Stop and ask me if either fix needs a rule change beyond its row's done-when, or if a test can show the difference only through a timing race you cannot make deterministic.

Owns: `src/core/scheduler/admission.ts`, `scheduler.ts` (`#facts()` only), `test/scheduler/admission*.test.ts`, new test files under `test/scheduler/` for these rows, one line in spec 019's `status.md`. Leave alone: `slow-tier.ts` beyond a read the fix needs, `tiers.ts`, `record.ts`, `request-intake.ts` (cards 6 and 7 may start in these files now).

Done when: each row's done-when; lint and typecheck pass; `squeal status --wait 60000` on the changed paths, with pending or unknown files named; `test/keys/key-format.test.ts` passes with no raise. Notes in `tasks/011-341/notes.md` (both rows): each test's result before the fix, the fix or the reason for none, and a "behaviour" line naming what a user would see change.

## R1: review of cand/0.1.502

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.502` at `b83018e0e07d97cd5ad8a863d2140c255acea697`; range `049563bc2..b83018e0e`: worker 0c0970aa's three commits (row 011-341 fix, row 011-342 fix, notes), then the 0.1.502 version raise and bundles. Behaviour to compare against: `049563bc2` (0.1.501). Read: board rows 011-341 and 011-342, `research/admission.md` (differences 1 and 2, Rows items 2 and 3), `tasks/011-341/notes.md`, this file's W1, `reviews/0.1.498.md`.

Check, each as proven, plausible or unverified:

1. **Each defect was real before its fix.** `admission-runner-work.test.ts` and `admission-rewalk-lanes.test.ts` fail at `049563bc2` (revert only the `src/` part of each fix) and pass at the pin; neither depends on a timing race (the notes claim 5 of 5 and 3 of 3).
2. **011-341**: no lane starts a tier while runner work is pending, whatever its `after`; the refusal order (`stopping`, `runtime-gone`, `held`, `runner-work`, then the lane's rules) holds; a lane refused for runner work is asked again after the drain and cannot stall (no lost wake, no busy loop); `waits` and the published activity are unchanged; spec 019's `status.md` line reads D3 as the row says.
3. **011-342**: the re-walk gives way to any group lane's waiting activity; the read stays lazy (at most once per answer, after the halt check); a group with no stored activity reads as not waiting.
4. **Nothing else a user sees changes**: no message, status field, CLI output or key; `test/keys/key-format.test.ts` passes with no raise.
5. **Scope**: only `admission.ts`, `scheduler.ts` (`#facts`, `#laneWaiting`), the scheduler tests and the one spec 019 line.

The coordinator's tree at the pin passed lint, typecheck, build, `check:version origin/main` (0.1.501 to 0.1.502), and directly `key-format`, `version-sensitive`, `admission`, `admission-runner-work`, `admission-rewalk-lanes`, `admission-rewalk` (64 tests). Host policy as in `wave-85.md`. Write `reviews/0.1.502.md` and commit it on your branch.
