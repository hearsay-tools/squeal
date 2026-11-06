# Wave 26: a function not judged yet reads CRAP pending, with a reason (row 015-104, gh-155)

Coordinator 42107d25, 2026-11-06. The human approved #155 ("grab the issue about CRAP returning null"). Version 0.1.408 claimed. Host policy: no local full suite, no `squeal run --all`, no `pnpm run build` in a worker tree; private `/tmp` fixtures.

## 015-104

Use /worker. Shape: slice.

Outcome: `squeal code` never shows a listed function with complexity but no CRAP and no reason while coverage and CRAP are on; such a function reads CRAP pending with the condition it waits for.

Read: `research/issue-155.md` (Q4 a and b, "Output gap"), spec 015 D9 "Pending and unknown", "First judgement" and "Delivery", row 015-101 (`tasks/wave-24.md`).

Contract:
- JSON: `crap: { outcome: "pending", reason }`. Text: `CRAP pending: <reason>`.
- Reason, from the file's coverage summary: a pending file gives its existing pending words (`waits for a test file to run` and the others in `PENDING`) and the number of test files it waits for; a file with no summary entry, or judged at another blob, gives `the coverage step has not judged this file's current bytes yet`; an unknown file gives its existing unknown words.
- Where `squeal status` already names a recovery command for that condition (`squeal run --all` for runs under lookup-only), the reason names the same one. No new command, no `--wait` on `squeal code`.
- Unchanged: D9 judgements, stored states, transitions, collection, keys. An excluded file, coverage off or `crap.enabled` off print nothing new.

Seam and lead: `src/cli/code-coverage.ts`, `coverageByFunction`, the `if (judged === undefined) continue` at about line 135; give such a function its pending `crap` from `summary.files[path]`. Words beside `PENDING` in `src/cli/code-crap-reason.ts`. Check every reader of `squeal code --json` `crap.outcome` (evals parsers, plugin text) for the new value.

Owns: `src/cli/code-coverage.ts`, `src/cli/code-crap-reason.ts`, the `squeal code` text renderer that prints `CRAP unknown:`, their tests, and the `squeal code` passages in `plugins/claude-code/skills/squeal/references/policy.md` and `commands.md`. Leave alone: `spec.md`, `status.md`, the board, bundles, version.

Done when: red-first tests cover a new function beside a queued loader (Q4 a), a file judged at an older blob (Q4 b), an unknown file, an excluded file and CRAP off, in text and JSON; `squeal status --wait 60000` on the changed paths is current with no failure; lint and typecheck pass.

## 015-105: review of cand/0.1.408

Use /reviewer. Shape: review. Candidate `cand/0.1.408` at `56c47fb0876d8a6d9d49559bf23a1d9ef0097f7d`, range `b87d43004..56c47fb08`: `088ff5c56` and `e2384d979` (worker b61ffb0c: pending CRAP and its reason, tests, plugin references), `7f75843aa` (coordinator: a function not judged in an unknown file reads `unknown`, not `pending`), `56c47fb08` (version 0.1.408 and rebuilt bundles). CI run 42202193488. Also judge: the reason names `squeal run --all` with a fixed `squeal`, while `squeal status` takes the command name it is given (`src/core/status/code-status.ts:178`).

Check: (1) no listed function with complexity reads no CRAP and no reason while coverage and CRAP are on; (2) each reason is true for its condition, and no pending state hides a judged one; (3) D9 judgements, stored states and keys are unchanged (`test/keys/key-format.test.ts` passes with no key-format raise); (4) every reader of `crap.outcome` accepts `pending`; (5) bundles match the source and the version is raised everywhere (`pnpm run check:version origin/main`). No full suite, no `pnpm run build`. Write `reviews/0.1.408.md` with PASS or FAIL and commit it alone.
