# 005 wave 13: the hook messages review, first rows

From `research/hook-messages-2026-11-16.md`; rows 005-89 to 005-94 approved by the human, 2026-11-16. Coordinator: session 4d2ecbfc. Rule for every row: `status.md`, 2026-11-16 (a hook carries what the agent can use) and `docs/vision.md` principle 1, "Silence has to stay readable". Held for wave 14: 005-90 and 005-91 (they cross `format.ts` and `header.ts` with 005-92); then 005-93's code and 005-94.

No worker raises the version, builds bundles (`pnpm run build`) or runs a full suite. Verify with `squeal status --wait 60000 <changed-path>...`; a direct `vitest run` only with explicit paths and `timeout 600`.

## 005-89

Use /worker. Shape: slice. Outcome: a primer that does not fit its cap still names `squeal` and the path wait.

Read: research finding 1; 005 D6; the comments of `folded` and `waitSentence`.

Seam: `src/harness/shared/primer.ts`, `folded`. First edit: a primer test with cezar's coverage (Vitest and node:test with 2 projects; check groups `lint` and `tests` at edit, `run-loop` at pause, `browser` manual; slow declared with 0 files; `requireSlowSuite` off), red while the text lacks `` `squeal status --wait 60000 <path>...` `` or is over 1,500 characters. Then drop other text before the CLI name and the path wait: both slow sentences when the listing counts 0 slow files, then what you find cheapest, stated in your final message.

Owns: `src/harness/shared/primer.ts`, its tests, eval parser pins the primer text moves. Leave alone: `src/core/delivery/**`, `src/core/status/**`, the skill copies.

Done when:
1. The new test passes; under Claude Code no coverage of the test matrix gives a primer over the cap or without `squeal` and the path wait.
2. Codex's long CLI path keeps 004-78's behaviour.
3. Primers that fit today are unchanged, byte for byte.
4. lint, typecheck, affected tests current.

Final message: what is dropped in which order, and any coverage that still cannot fit.

## 005-92

Use /worker. Shape: slice. Outcome: a failure report says a repeated fact once.

Read: research finding 12; 005 D6; 011 C5 as amended (gh-32); row 011-67.

Seam: `src/core/delivery/format.ts` (`failureBlocks`, `entryBlock`, `formatRegistration`'s blocks), `provenance.ts` (`closureLine`, `beforeEditsText`), `src/core/retry/text.ts` (`recordedText`), `failure-groups.ts`. First edit: a `formatDelta` test with three failures whose `changesInClosure` are equal, red while the paths print three times.

Changes:
- Equal changed paths print once per message, after the blocks, in plain words with no "closure" ("These tests import files you changed: …"); a failure with other paths keeps its own line.
- A registration prints the retry advice once per message; each failure keeps its own age, revision and load in one short line.
- "no baseline result, may predate your edits" becomes: Squeal has no earlier result for this test, so it cannot tell whether your edits caused it (keep the settle clause).
- `squeal why` and `status` keep their texts unless they share the function; say which moved.

Owns: the files above, their tests, `evals/` parsers these lines move (round-trip the real formatters). Leave alone: `header.ts`, the title, the registration's head lines, `primer.ts`.

Done when: the tests above; block order, grouping, overflow counts and the `Full output:` line unchanged; lint, typecheck, affected tests current.

Final message: each text before and after, and every caller that changed.

## 005-93 design note

Use /researcher. Shape: research. Outcome: `tasks/005-93/design.md`, the note the human approves before code.

Read: row 005-93; `docs/vision.md` principle 1; research finding 8; `src/core/delivery/edits.ts`, `delivery.ts` (`onToolBoundary`), `header.ts` (`newsLine`), `src/core/status/feed-late.ts`, `liveness.ts`.

Answer, each with evidence or "not determined, because":
1. When do results for a consumer's edits count as late? Propose a rule from the machine and the files' stored durations (no host-tuned number), and what it would have said on real sessions: use the stores and transcripts of recent worktrees, read-only.
2. Can a message built at a tool boundary miss an edit of the same tool call? Read the path from the hook to the revision; a cheap experiment in a scratch repository if needed.
3. How often is the settled line sent today against how often an edit's files all finish?
4. The exact texts: late, caught up, and the news header that counts the consumer's own files; what a consumer with no edit reads.
5. Which existing notices these replace (heartbeat late, feed late, the queue counts), and what stays in `squeal status`.

Owns: `tasks/005-93/`. No product code. Final message: the open choices for the human, as options.

## Review of cand/0.1.525

Use /reviewer. Shape: review. Pinned to the `cand/0.1.525` SHA named in the spawn; the range is from the base named there to that SHA. It holds 005-89 (one commit of worker bc2f6f2a), 005-92 (two commits of worker c40bae5d), both cherry-picked with `-x`, and the release commit (0.1.525 and the bundles). Read rows 005-89 and 005-92, this file, `research/hook-messages-2026-11-16.md` findings 1 and 12, `status.md` 2026-11-16.

Judge:
- 005-89: a primer that fits `PRIMER_CAP_CHARS` today is byte-identical; one over the cap names `squeal` and the path wait within the cap under Claude Code; the drop order (slow sentences at 0 slow files, the second slow sentence, the retry sentence, "Run tests yourself only when…", the revision definition) loses no fact an agent needs that nothing else says; Codex's long CLI path keeps 004-78's behaviour; `trailingPrimer` still finds every primer.
- 005-92: each failure's facts are still stated once at least (no path, age, load or retry state lost when lines merge); the shared line is true for every block it counts; a registration with one recorded failure is byte-identical; the retry command names only failures a load retry applies to; `squeal why`'s moved line; block order, grouping, overflow counts and `Full output:` unchanged; the evals parsers round-trip the real formatters, old and new text.
- Every changed sentence against the human's test: it is for the agent in the session.

No full suite and no full-suite checkpoint (`docs/process.md`); candidate CI is the full suite: name its run and result. Affected results through `squeal status --wait 60000 <path>...`. Write `reviews/0.1.525.md` and commit it on your branch.
