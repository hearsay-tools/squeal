# Wave 24: three approved coverage triage rows (gh-115, gh-122, gh-129)

Approved by the human on 2026-10-30, decision card "Coverage: As recommended" (rows on `docs/board.md`). Coverage stays opt-in. Add no new mechanism: no new policy key, no scope rule, no changed default. One worker, one candidate.

## W1 — 015-99, 015-100, 015-101

Use /worker. Shape: slice (three small parts, one commit each). Read spec D1, D6, D9, `status.md` (015-75, 015-78 amendments) and `research/issue-115.md`, `issue-122.md`, `issue-129.md`.

1. **015-99 (gh-115).** Where a file over the size limit is reported, name the key. Seams: `src/cli/code.ts` `fileLine` case `too-big`, and `src/core/delivery/code-format.ts` `notJudgedFile`. Lead: `over the 512 KiB limit (complexity.maxFileBytes)`. Name the key in the `complexity.maxFileBytes` row of each `skills/squeal/references/policy.md` copy (claude-code, codex-runtime, codex/seed, pi; keep them identical). Default stays 524288.
2. **015-100 (gh-122).** Guidance only. In the same `policy.md` copies, beside `coverage.exclude`, one or two sentences: test helpers shipped inside a package that a manual or built-output run uses are measured as product code; exclude them explicitly with `coverage.exclude`. No code.
3. **015-101 (gh-129).** When a function's CRAP is unknown, state one short reason in `squeal code` text and JSON. Seams: `src/cli/code-coverage.ts` `coverageWords` / `coverageByFunction`, `src/cli/code-report.ts` `CodeReportCoverageOf.crap`; read the cause from `src/core/code/crap/summary.ts` `FileSummary` (file condition: pending kind or unknown kind) and the function's own join state. Lead: an optional `reason` string on unknown CRAP. Use the existing causes only; when none is known, say "cause unknown". Line counts never make a numeric score; D9 judgements stay unchanged.

Own: the seams above, their tests (`test/cli/`, `test/code/crap/`, `test/delivery/`), the `policy.md` and `reports.md` copies, `tasks/015-99/notes.md`. Leave alone: policy defaults, the scheduler, the daemon, setup skills, version and bundles.

Done when red-first tests show: the too-big line and session notice name `complexity.maxFileBytes`; an unknown CRAP beside measured lines (skipped loader, as in `test/code/crap/skipped-pass.test.ts`) prints and serializes its reason, and the reason goes away when the loader runs and CRAP is numeric. Lint, typecheck, `squeal status --wait 60000 <changed paths>`; report pending or unknown checks. Final message: type changes and open decisions.

## W2 — 015-102: review the candidate

Use /reviewer. Pinned to the SHA in the spawn; range named there. Read W1, spec D6/D9 and `tasks/015-99/notes.md`. Own only `reviews/<version>.md`. Check that D9 states are unchanged, the reason is true for each cause, JSON stays additive, the documentation copies agree, and the version and bundle integration. Targeted Squeal results and candidate CI; no local full suite, no product change.
