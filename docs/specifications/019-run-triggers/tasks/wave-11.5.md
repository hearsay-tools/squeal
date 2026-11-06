# Wave 11.5: repair of cand/0.1.411 (row 019-49)

One worker, shape: repair. Use /worker.

**Outcome.** Blockers B1 and B2 of `reviews/0.1.411.md` are fixed, each with a regression test, and nothing else changes.

**Read.** `reviews/0.1.411.md` (B1, B2 and "Inputs for the repair"), spec 019 D6 items "No test group at `edit`" and "Narrow run".

**B1, primer cap.** `src/harness/shared/primer.ts`, `primer()` and its folding loop. With no test group at `edit` plus a slow tier, no fold fits, and the over-cap `none/plain` text is returned (1,590 characters in Claude Code, 1,522 in Codex). Lead: give the no-edit wording a shorter fold step that keeps the warning ("silence between edits is not a pass") and keeps the folding order. Never cut whole sentences. The output for a policy with a test group at `edit` stays byte-identical. Test: the review's reproduction (D6 groups, `slow.include: ["test/browser/**"]`, one listed browser file) through `sessionStart` in both harnesses, plus a matrix over slow settings, coverage folding and a long Codex CLI. Every primer stays within `PRIMER_CAP_CHARS`.

**B2, unknown read as current.** `src/cli/run-group-narrow.ts:131` and `:140` infer current = selected - queued. `src/core/scheduler/narrow-run.ts:95-108` leaves files out of the queue when their key is absent or their runner is blocked. Lead: the narrow answer carries an explicit count, or a list, of selected files that could not be queued, with the reason. The CLI names them as not run, not current, and never claims current for them. `--wait` keeps exit 3 for unknown results. Tests: a scheduler test with a failed `closure()`, and a CLI test for a blocked file alone and for a blocked file beside a current file.

**Owns.** The files above and their tests. The answer type is in `src/core/types/scheduler.ts` and `daemon.ts`; keep the change additive.

**Leave alone.** `docs/`, the `package.json` version, `plugins/*/dist`, `plugins/codex-runtime/runtime.json`. Do not run `pnpm run build`.

**Done when.** Both regressions fail on the candidate and pass after the fix. Lint and typecheck pass. `squeal status --wait 60000` on the changed paths: report it. Unset `CODEX_SESSION_ID`, `PI_SESSION_ID` and `OPENCODE_SESSION_ID` for CLI-text tests run by hand. Do not wait for files beyond those the change reaches.
