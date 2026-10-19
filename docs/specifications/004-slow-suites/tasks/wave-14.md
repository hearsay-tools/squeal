# Wave 14: an agent knows it can wait for slow files (004-83)

The human, 2026-10-19, after the confirm run 86f831 on 0.1.221: "Wording first. And I think there needs to be a mechanism for the model to wait for slow files and it needs to know it can. Otherwise, they won't reliably use it." Spec: D8 and the 004-71 paragraph as amended 2026-10-19 (`spec.md`), D9.

## 004-83

Use /worker. Shape: slice. Outcome: every Squeal text that names slow files not current names `squeal run --slow --wait 60000` as the way to wait for their results, and that command waits for a slow file already running instead of restarting it.

Evidence: cells under `/tmp/squeal-evals-1001/cells/e5dfb8a03a5b/20261019T090107Z-86f831/` (read only). In `a2-slow.p0.codex-gpt-6-luna.*`, the plain wait returns on quiet after 0.5 s while the slow file runs (about 12 s). The policy-off line offers only `squeal run --slow` ("runs it"). The primer says `run --slow --wait 60000` "runs them now". Luna claims "unknown, 2 checks running". In `a8-load-hold.*`, the policy-on line names `run --slow --wait 60000` "which this wait does not hold for", and Luna ran it every time.

1. **Mechanism.** Verify by test: a slow file running at the current revision, then `run --slow --wait`: does it join that run or queue a second one? Start in `src/cli/run-slow.ts` and `src/cli/status-wait-slow.ts` (`run --slow --wait` holds only for the files the request queued). It must join and hold for every slow file not current at the current revision. Fix it if not.
2. **Text.** Name the command as a wait, "`squeal run --slow --wait 60000` waits for their results", in:
   - the policy-off quiet line, `src/cli/status-wait-lines.ts:150` and `:236`;
   - the `Slow tier:` line's ending, `src/core/state/slow-text.ts`;
   - the primer, `src/harness/shared/primer.ts`, in both policies, keeping 004-78's rule that the Codex primer names the CLI at any path length;
   - the `Affected checks` headline, `src/core/status/format-status.ts`: name the slow files among its running or queued checks, by path up to a few and then by count.
   Policy on keeps "which this wait does not hold for". The plain `status --wait` still does not hold for slow files.
3. Skill references in `plugins/*/skills/squeal/references/` that quote these lines.

Own the files above, their tests, `evals/lib/squeal-text.mjs` and `slow-claim.mjs` (the parsers must read 0.1.215 to 0.1.221 text and the new text; round-trip through the real formatters, not fixtures), and the version raise to 0.1.222 in the eight places. `KEY_FORMAT_VERSION` 13 is unreleased: re-pin 13 in place if guarded sources change. Leave alone: the scheduler's trigger and ranking (004-80, 004-82), setup, the board, the specs. No `npm run build`, no eval runs (`evals/bin/run-baseline.mjs` has no `--help`), nothing against the real HOME.

Done when:
- a test with a slow file mid-run shows `run --slow --wait` joining it and returning its result, red before any fix;
- formatter tests pin each text under both policies;
- the parser round-trip tests pass;
- `squeal run --all --wait`, lint and typecheck are clean;
- notes list every changed text, before and after.
