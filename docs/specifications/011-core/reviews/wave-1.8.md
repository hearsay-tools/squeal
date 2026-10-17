# Wave 1.8: candidate 0.1.206

PASS `ca832142c8f011139385bfd0de202accc4108142`. 0 blockers, 1 should-fix, 1 resolved note.

## Verification

Candidate HEAD was exactly `ca832142c8f011139385bfd0de202accc4108142`; the checkout remained clean throughout verification. Reviewed the product delta from `origin/main` and rows 004-66, 005-68, 011-04 and 011-07 against their board Done-when and briefs. Main's intervening changes are docs only. Read 004 D9 including `de61aeac`; 005 D6 including its subsequent docs correction `f00b3a37`; 011 C6, C7, C9 and C10.

Commands and output:

```text
npm ci
added 196 packages, and audited 197 packages in 8s
found 0 vulnerabilities

npm run lint
> squeal@0.1.206 lint
> biome check .
Checked 1381 files in 410ms. No fixes applied.

npm run typecheck
> squeal@0.1.206 typecheck
> tsc --noEmit

npm run check:version -- origin/main
version bump: 0.1.205 -> 0.1.206, ok

flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 Test Files  686 passed | 1 skipped (687)
      Tests  5820 passed | 9 skipped (5829)
   Start at  11:02:08
   Duration  759.28s (tests 98%, import 2%)
exit 0
```

`npm ci` also reported the existing deprecation and install-script approval warnings; it exited 0. Lint, typecheck, the version check and the independent full suite exited 0. The independent Vitest run is the review gate, not the installed Squeal daemon's checkpoint. `npm run build` was deliberately omitted as instructed; build regeneration is unverified by this review.

The installed 0.1.199 Squeal daemon separately reported two recorder-fidelity baseline failures (`run-reads-fidelity.test.ts` and `observe-fidelity.test.ts`). Those were not the independent run above, which passed all executed tests; no Squeal checkpoint was substituted for the required gate.

Two throwaway source probes, outside the checkout:

```text
1400 primer combinations checked; 226 gain the path wait; max 1500/1500 characters; existing coverage and non-wait instructions unchanged.
Three skill copies: steps and references/commands.md agree.
{"quickRecovery":{"state":"alive"},"lapse":null}
Fresh, cleared, live stale, and long-dead socket states agree with D9.
```

The primer comparison used the unchanged 0.1.205 source on main against the pinned candidate. It covered Claude Code, Codex, Pi and OpenCode command forms, three additional path lengths, Vitest on/off, independently varied node:test and pytest project counts (0, 1, 2, 10, 40), and absent, uncounted, optional and required slow tiers. Both probes exited 0 and changed no tracked file.

## Blockers

None.

## Should-fix

### S1 (proven): a lapse recovered between polls loses its explanation

`src/cli/wait-liveness.ts:75`, `:83` and `:92`. The socket completion remembers only `listening`; `staleMs` is updated only on a subsequent poll that still sees a stale heartbeat. If the ping answers and the heartbeat recovers before that poll, the fresh branch clears the socket result and returns `alive`, with `lapse()` still `null`. Thus the final wait line omits the explanation of the lapse it waited through, contrary to 004 D9's sentence, "A wait that went on through a lapse says so on its first line, with the lapse's length."

Reproduced with a real Unix socket: judge a heartbeat 20 seconds old, let its ping answer, then judge a fresh heartbeat 30 ms later. Result: `{"quickRecovery":{"state":"alive"},"lapse":null}`. The wait still requires a fresh heartbeat before quiet or a named verdict, so this is a reporting omission, not false validation or a false stopped-daemon report.

One-worker fix: retain the observed stale age when launching the probe, and record that lapse when its socket confirms liveness, including when freshness returns before the next stale read. Add a regression for recovery between polls. Keep an absent socket from claiming a live lapse.

## Notes

### N1 (proven, resolved): 005 D6 still described the old primer

At the pinned candidate, `docs/specifications/005-agent-adoption/spec.md:138` said "The primer does not change for it" and the amendment log omitted 005-68. The board and brief already authorized the new text. Reported to the coordinator, who landed docs-only `f00b3a37`; fetched and verified that it amends D6 and records the dated decision, including the no-further-folding rule and the deliberate unchanged setup block. No outstanding action.

## What fits

- **004-66:** both status wait implementations share `watchDaemon`. Plain `status --wait` and the slow request's post-acceptance wait use `waitForStatus`; all named selections use `waitForNamed`. Fresh heartbeats are alive, cleared records mean stopped, and stale records probe the recorded and computed sockets. A socket that answers or accepts without answering keeps the wait lapsed; a dead socket uses the 10-second bound from the heartbeat grace's lapse, with elapsed time retained across polls. Quiet and named verdicts require `alive`. A news return remains news, not a named verdict. Slow wait exits 3 for no daemon or deadline with held slow files pending; ordinary status wait exits remain unchanged. The regressions cover recovery without another run request, a hung socket, cleared and dead records, the long-gone case, and exit 3.
- **005-68:** the algorithm first finds exactly the old fitting coverage/naming combination, then adds the new wait sentence only if that same combination still fits. The comparison probe establishes no extra folding and the cap across the matrix. Three shipped skill copies agree; OpenCode has none. `commands.md` states that a listed test path selects only itself and gives the slow wait's exit 3. `src/cli/setup/block.ts` is byte-identical to main on purpose: it still correctly describes the before-done wait, without a block version migration.
- **011-04:** attribution is read from the actual replacing row, independently of the 20 displayed results. Errors are labelled with their producing worktree and run. The known failure's own log is resolved using the failure producer's run id through `runs.log_dir`, with origin/key guards, rather than guessed from the replacement. `runLogUnavailable` distinguishes no state, no origin, replacement without producer evidence, a pruned producer run, no stored result and an unidentified result. Both the scheduler-backed two-worktree regression and seeded edge cases preserve A's known state, including after the history cap. No state, result-retention or schema writes were added to the reader.
- **011-07:** the snapshot and no-store result both read problems from the existing policy loader; one formatter renders the line. The changes outside the brief's listed files (`format-status.ts`, `types/status.ts`, and the helper) are the needed formatting and additive payload seam. Valid or missing config adds no property or text; the test compares text, JSON and codes byte for byte. Status keeps its exit 0/1 behavior. The session header and loader rules are unchanged.
- **Integration:** all eight version files say 0.1.206 (the lockfile's two version fields included). Key format remains 11 with its candidate source hash re-pinned; the last release tag `squeal--v0.1.199` has 10. No previously released format-11 meaning is being silently changed.

## Inputs for the next wave

S1 is bounded to the liveness helper and a between-polls regression. Preserve the shared judge for both status waits, the 10-second down bound, and the rule that a lapsed heartbeat supplies no quiet or named verdict. Keep the primer's old fitting coverage/naming combination when adding any further text. No fix wave is needed for a blocker; integration remains the coordinator's decision.
