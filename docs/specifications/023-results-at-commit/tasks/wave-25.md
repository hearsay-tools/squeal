# Wave 25 (row 023-41): delete the in-call run and take-back. Use /worker.

The human chose (2026-11-22) to release 0.1.595 and start row 023-41 ("Release + 023-41"). 0.1.595 moved `status --at --run` onto the commit daemon and the worktree daemon (rows 023-40, 023-46). The old path is no longer reachable; this row deletes it. It is a repair-shape row: subtraction, no behaviour change for users.

Read `../spec.md` D4 and D7 (as amended 2026-11-21/22), `tasks/023-40-notes.md` (its section "What row 023-41 deletes" is the list to work from; also the Round 4 and Wave 24 sections), `research/run-wait-model.md` Q6, `reviews/wave-23-fifth.md` and `reviews/0.1.595.md` (its two notes). Base: main at 0.1.595. Never write the lab VM host name, the company name, sandbox ids or home paths in committed files (`pnpm run check:private` with `set -o pipefail`; grep your diff). Host is shared: direct vitest only with `timeout 600 pnpm exec vitest run --maxWorkers=2 <paths>`; no full suite; no version, no build; nothing left running.

## Scope

1. **CLI side** (`src/cli/status-at*.ts`): delete what the notes list (the in-call run, its loop, fit, use, setup, give-back, unkept, run-now and its gate, `status-at-both.ts`, the `RunUse` report branch, `commitRun`'s `run` branch). Keep what the notes keep (`status-at-run-select.ts`, `estimateOf`/`tellsEstimate`, `status-at-run-child.ts` and `status-at-run-outcome.ts` while `proof`'s conditioned sides use them, `takeRunRequest`/`runChild`). Before deleting each file, prove nothing reachable imports it (grep plus typecheck); keep anything `proof` still uses and say so.
2. **Daemon side** (spec 011 files, coordinator-approved; commit subjects say "(spec 023 D7; 011 files, coordinator-approved)"): take-back (`TakeBackRequest`, `scheduler/take-back.ts`, `daemon/take-back-requests.ts`, owner claims in `narrow-run.ts` and `queue.ts`, protocol/handler/type entries). Keep `lead`, the `at` flag and the `SQUEAL_RUN_GROUP` token (T3); `owner` shrinks to what the run-group flag needs, or goes if the covered-files id replaces it (say which).
3. **Tests**: delete the tests that only test the deleted paths (the notes list them); keep and adapt any that test kept behaviour through the old path. Add the direct `askNow` pending-path test the 0.1.595 review asked for (a real child against a socket whose sync stays pending; red when `keptAlive` is removed from `askNow`).
4. **Small fixes from reviews/0.1.595.md**: the two `023-40d` references become `023-40e`.
5. **Manual e2e**: `test/e2e/at-commit-status.test.ts` (gated by `SQUEAL_E2E_AT=1`, built bundle) still expects the in-call run's lines. Update its expectations to the daemon path's text from the code (you cannot build; the coordinator runs it after the build).
6. **Key format**: if a deleted or changed line is in a key-relevant bundle, run `test/keys/key-format.test.ts` and the validity cases; deletions of unreached code should not move keys.

## Done when

- Typecheck, lint, check:private pass; `status --at` tests, daemon run-group tests, scheduler queue/narrow-run tests, key-format and validity pass when run directly; `squeal status --wait 60000 <changed paths>` read.
- Notes in `tasks/023-41-notes.md`: what was deleted (files and line counts), what was kept and why, any behaviour that changed (should be none).
- Commits on your branch; do not edit `docs/board.md`.
