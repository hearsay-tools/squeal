# Wave 1.7: the bytes ESLint read are the bytes in the key

The human, 2026-10-26, on the third FAIL (`reviews/0.1.351.md` B2-R3): "Repair the cause." One repair, then one review; a FAIL goes back to the human. All six blockers so far have one cause: a stored result's key did not hold exactly what ESLint read. This round makes that one rule, with tests that check it the way the reviewers attacked it.

## R4, the provider and the pass

Use /worker. Shape: repair. Worker 2e373245, on `int/017-w1` (move `cez/2e373245` there; your tree is clean). Workers run on claude opus xhigh.

Outcome: every byte ESLint used for a stored result is either text the pass gave it or a hash the worker reports of exactly the bytes it read; the key holds those hashes; when the pass's own disk read differs from the worker's, it refreshes and keys again, and stores nothing when it cannot settle.

Read: `reviews/0.1.351.md` (B2-R3 and its fix scope) and `reviews/0.1.348-r2.md`; spec 017 D4, D5; your `tasks/017-04/notes.md` decision 14 and its "Not covered" list.

Seams, as a lead: `provider/observe.ts` hashes the bytes its `readFileSync` patch returns, and a `load` hook's source beside its resolve hook; `provider/program.ts:371` hashes the text it reads; the snapshot and the run report carry those hashes for inputs outside the listing and `node_modules`; `pass/unlisted.ts` compares its disk read with the worker's hash and never takes a first look as the worker's bytes; a report whose hashes differ from the key's stores nothing. `LINT_KEY` goes to `squeal-lint-key/3`, so version-2 results are not reused.

Owns: `src/core/lint/pass/**`, `src/core/lint/provider/**`, `test/lint/**`, `test/fixtures/lint/**`, your notes. Leave everything else alone. No `npm run build`.

First step: send me a request with your design and B2-R3 as a red test before you build past it.

Done when:
- B2-R3's six steps are a real-provider test: the first pass stores `after` or nothing, and the clean second root lints;
- an edit-injection test: a provider wrapper edits an unlisted rule and an unlisted program file after each provider call returns and inside the install callback; at every point the stored findings equal a fresh ESLint at the key's bytes, or nothing is stored;
- a read-set test on ESLint 9 and 10: every file the worker read outside the listing and `node_modules` is in the key with the hash of the bytes it read;
- the earlier B1 to B3-R tests stay green; lint and typecheck pass; `squeal status --wait 60000` on your changed paths; no full suite;
- your notes list no limit that lets a stored result differ from a fresh ESLint at its key's bytes: such a limit is a request to me, not a note.

## Review of cand/0.1.353

Use /reviewer. Candidate `cand/0.1.353` `26b12b955` on main `63725249d` (0.1.352). Whole range `63725249d..26b12b955`; this repair `9e034cacb^..26b12b955`. Re-review against `reviews/0.1.348.md`, `0.1.348-r2.md` and `0.1.351.md`: every earlier blocker's reproduction must still fail to break.

Read: spec 017 D4 and D5, especially "The bytes ESLint used" and its five accepted boundaries; this file; `tasks/017-04/notes.md` decisions 19 to 30 and its open cases.

Prosecute the rule: find an input ESLint used for a stored result whose bytes the key does not hold, outside the five boundaries. A case inside a named boundary is a note, not a blocker. If you think a common plugin crosses a boundary, it is a finding: name the plugin.

Checks at the exact candidate, on Node 22 and 24: lint, typecheck, and `npx vitest run test/lint/ test/harness/plugin.test.ts test/harness/codex/plugin.test.ts test/harness/opencode/package.test.ts test/harness/pi/package.test.ts test/keys/key-format.test.ts test/code/pass/daemon.test.ts test/scheduler/capacity-gate.test.ts test/scheduler/capacity-pool.test.ts test/scheduler/slow-pool.test.ts test/scheduler/tier-sharing.test.ts --maxWorkers=2`; compare-refs at `squeal--v0.1.352`; `squeal status --wait 60000` on the changed paths. No `npm run build`, no full suite, no `squeal run --all`. Probes stay outside the repository and never reach the real HOME. Run `squeal stop` when you finish.

This is the last round the human authorized. Write `reviews/0.1.353.md` with PASS or FAIL and commit it alone. A FAIL goes to the human.
