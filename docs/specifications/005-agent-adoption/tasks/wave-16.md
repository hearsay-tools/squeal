# 005 wave 16: the own count without late messages; the wording pass's texts

The human, 2026-11-17: row 005-93 is split (card option A); 005-94 starts; 005-95 is approved. Coordinator: session 4d2ecbfc. Two workers on disjoint work: W1 changes code under `src/core/delivery`; W2 writes one document and changes no code.

Rule for both: `status.md`, 2026-11-16 (a hook carries what the agent can use) and `docs/vision.md` principle 1. After coordinator c3fe14c9's check lands, a push fails on a home-directory path: write `~`, never `/home/<user>/`, in docs, notes and probes.

## W1: 005-93, the own count (part 1 of the split)

Use /worker. Shape: finish. Outcome: a change delivery's header counts the agent's own test files, and nothing in a hook says "late" or "caught up" yet.

The work exists on `origin/wip/005-93` (built on 0.1.529; reviews `reviews/0.1.530.md` and `reviews/0.1.530-r2.md`, notes `tasks/005-93/worker-notes.md`). The re-review confirmed its message side and failed only the scheduler write. Carry over, onto your branch from main, what needs no late state and no scheduler fact:

- the news header's own count ("3 of the 9 test files your edits affect have not run", "… have all run", the unknown clause of review B4), and no count for a consumer with no edit;
- the settled line (001-223) and its joined form removed; the first-edit line's "affects";
- `readOwn` and the owed rule (no result at the file's key) in `edits.ts`, with its tests;
- the evals parsers and `grade.mjs` for these texts, the skill `reports.md` copies (only the own-count example), the `accepted` list of the 0.1.393 control, the e2e agreement reader.

Leave out, entirely: `late.ts`, `late-format.ts`, `late-bound.ts`, `late-timings.ts`, `src/core/scheduler/edit-timings.ts`, the call in `tier-start.ts`, the `edits-late:` and `edit-timings:` meta keys, the late and caught-up titles and texts, and every test of them. The late-feed and unlisted sentences stay in the news header as on main (no late message says them yet). Do not copy the wip branch's `pool-wait.ts` or `scheduler.ts` state: main moved there.

First step: `git diff origin/main origin/wip/005-93 -- src evals test plugins/*/skills` and sort each hunk into carry or leave; say in your notes how `since` moves now that no late state holds it (it moved "when a delivery shows every file run"; keep that).

Owns: `src/core/delivery/{edits,delivery,header,format,content-title}.ts`, `src/core/types/delivery.ts`, their tests, `evals/lib/{squeal-text,grade}.mjs` and their tests, the `reports.md` copies, `test/e2e/{agree.ts,run-triggers-control.test.ts,transitions.test.ts}`. Leave alone: `src/core/scheduler/**`, `src/core/store/**`, `primer.ts`, the registration and Stop full header.

No version raise, no `pnpm run build` in your worktree, no full suite. Run: lint, typecheck, `test/delivery`, `test/evals`, `test/harness/skill.test.ts`, `test/keys/key-format.test.ts`, and the four e2e text files one at a time from a scratch worktree build (`run-triggers-control`, `lifecycle`, `transitions`, `run-triggers`), each with `timeout 900`. `squeal code` on the files you touch: no function newly over the threshold (`editNotes` was 23 on the wip branch).

Done when: tests for each carried text, each red against main; `git grep -n "late-\|caught up\|edit-timings\|edits-late" src evals` finds nothing you added; the checks above.

Final message: the hunks you left out and why; each text before and after; the check results.

## W2: 005-94, the texts before any code

Use /researcher. Shape: research. Outcome: `tasks/005-94/texts.md`, the before and after of every sentence the wording pass changes, for the human to approve.

Read: row 005-94; `research/hook-messages-2026-11-16.md` findings 3, 4, 13 and the audience table; `status.md` 2026-11-16 and 2026-11-17; `docs/vision.md` principle 1; `src/harness/shared/primer.ts`; `src/core/delivery/header.ts` (`fullLine`), `format.ts` (`formatRegistration`); `src/harness/shared/text.ts` and `stop-text.ts`; the skill `SKILL.md` and `references/reports.md`; `GLOSSARY.md`.

Write, each as before (verbatim, from the real formatters: call them in a throwaway script, do not retype) and after (your proposal), for three coverages (this repository's default; cezar's: Vitest and node:test, check groups with a manual group, slow declared with 0 files; a repository with `stop.requireSlowSuite` on):
1. The registration: without the full-suite checkpoint sentence and the Inherited and Imported sentences; counts an agent can read (say what "current", "pending", "stale", "unknown" become, or define them once); the `· sha + N, dirty` suffix.
2. The primer: the path wait in every primer that fits; "passing results stay silent" allowing for a reported recovery; "Run tests yourself only when … results are unknown" against finding 2; within `PRIMER_CAP_CHARS` for all three coverages, with the lengths.
3. Stop's text for a worktree with no results yet (it still prints "Known failures: 0", `text.ts`).
4. The late-feed sentence: a time zone and a next step.
5. The words "re-keyed", "closure", "lookup-only", "test files without checks" wherever a hook says them: replace or define.
6. The skill sentences that describe these texts (`SKILL.md` "those files and non-zero counts only").

For each change: which finding it answers, who the sentence is for (agent, or the person on request), and where a removed fact stays readable (`squeal status --full`). Then: what an atomic eval run must show for this pass (which cells of `evals/ATOMIC.md` read these texts), without running any eval. List what you did not decide, as options.

Owns: `tasks/005-94/`. No product code, no eval run, never run a script under `evals/bin`. Final message: the open choices for the human.

## Review of cand/0.1.534

Use /reviewer. Shape: review. Pinned to the `cand/0.1.534` SHA named in the spawn; the range is from the base named there to that SHA. It holds row 005-93 part 1: three commits of worker a1eb0936 (cherry-picked with `-x`) and one coordinator commit (the release 0.1.534 with bundles and this section). Read row 005-93 as rewritten, this file's W1 section, `tasks/005-93/part1-notes.md` (each hunk carried or left, how `since` moves), `reviews/0.1.530.md` and `reviews/0.1.530-r2.md` (what was confirmed and what failed on `origin/wip/005-93`), `status.md` 2026-11-17.

Judge:
- Nothing late: no late state, no late or caught-up text or title, no bound, no scheduler or store change, no new meta key came with the carry-over (`git diff <base>..<sha> -- src/core/scheduler src/core/store` is empty).
- The own count: a change delivery's header counts the consumer's own test files and nothing of the worktree's queue; "have all run" is said only when no file of its recorded edits is owed (no result at the file's key; judge the confirmation-run case of review wave 13v B1 again); the unknown clause; a consumer with no edit gets no count and nothing that reads as a pass; registration, Stop and `squeal status` unchanged.
- `since` moves only when a delivered header shows the own count with no file owed: judge every delivery path (tool boundary, Stop, peek, the idle waiter, turn start, an unrefined revision) for a header that says "have all run" too early or a count that never resets.
- The late-feed and unlisted sentences stay in the news header as on main.
- The settled line is gone from every harness's texts, the skill copies and the parsers; `evals/lib/squeal-text.mjs` and `grade.mjs` round-trip the real formatters, old and new headers, and a header with no count never reads as a pass.
- Complexity: no function newly over the threshold (`squeal code` on the touched files).

No full suite and no full-suite checkpoint; candidate CI is the full suite: name its run and result. `test/e2e/**` is outside Squeal's coverage: say which e2e files you ran directly (control, lifecycle, transitions, run-triggers). Write `reviews/0.1.534.md` and commit it on your branch.
