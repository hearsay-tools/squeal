# Wave 8: candidate 0.1.207

PASS `be25bf0fdb8b52c1780a09790a7844aed970611b`. 0 blockers, 1 should-fix, 2 notes.

## Verification

HEAD was exactly the pinned candidate. Reviewed `a177145e..be25bf0fdb8b52c1780a09790a7844aed970611b`, board rows 004-67 and 004-66's S1 follow-up, wave-8's 004-67 brief, worker notes, issue-19 research, 004 D8/D9 and their amendments, 005 D6 and its status amendment, and the previous `011-core/reviews/wave-1.8.md` S1. Product files stayed unchanged throughout the review; the checkout was clean during the independent gate.

```text
npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
exit 0

npm run lint
> squeal@0.1.207 lint
> biome check .
Checked 1383 files in 459ms. No fixes applied.
exit 0

npm run typecheck
> squeal@0.1.207 typecheck
> tsc --noEmit
exit 0

npm run check:version -- a177145e
version bump: 0.1.206 -> 0.1.207, ok
exit 0

flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 Test Files  687 passed | 1 skipped (688)
      Tests  5836 passed | 9 skipped (5845)
   Start at  11:33:33
   Duration  753.01s (tests 98%, import 2%)
exit 0
```

`npm ci` also reported the existing node-domexception deprecation and six install-script approval warnings. The independent Vitest run above is the required reviewer gate; Squeal's checkpoint was not substituted for it. `npm run build` was deliberately omitted as instructed, so bundle regeneration/drift is unverified by this review. Version 0.1.207 agrees in all eight version files, including both version fields in the lockfile.

The installed 0.1.199 Squeal daemon separately reported the two recorder-fidelity baseline failures (`test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`) already tracked as 001-431. They are distinct from the independent gate, which passed both files. The gate also emitted fixture gitdir-repair, earlier-run process cleanup and experimental Vitest typecheck notices; none failed a check.

Throwaway source probes outside the checkout, using the candidate's real SQLite store and source functions:

```text
Store probe: 8 cases pass; same-daemon no-edit true, absent facts/revision/re-registration/restart false. Existing 12 h parked-registration expiry starts fresh.
Primer probe: 1000 combinations; maximum 1500/1500 characters; 2 lost project names; no old path-wait instruction lost; policy-off/no-slow output byte-identical.
Three shipped skill copies: slow step, commands and policy agree; OpenCode has no skill copy.
```

The store probe also writes a file before appending a revision: exemption remains true until the revision is stored, confirming N1's documented observation boundary. Probes changed no tracked file.

## Blockers

None.

## Should-fix

### S1 (proven): the shorter slow sentence can trade previously named projects for repeated CLI naming

`src/harness/shared/primer.ts:77` and `:221`; `test/harness/primer-slow-policy.test.ts:88`. The new policy-on sentence is six characters shorter, but that does not prove the worker note's claim that every fold decision stays the same. The unchanged loop prioritizes CLI naming (`every`, then `first`, then `none`) before how many projects it names. A previously rejected `every` candidate can now fit with more projects folded, displacing the old `first` candidate that named them.

This is a **should-fix against the coordinator's explicit preservation rule**, not a blocker against 004 D8 or 005 D6. D8's required policy text and the cap still hold. D6's no-further-folding rule concerns adding the path-wait sentence; that sentence still uses the already selected coverage/naming combination, and no old path-wait instruction is lost in the comparison. The no-edit Stop behavior and the row's Done-when regressions are unaffected.

Exact comparison matrix against 0.1.206's source at `a177145e`: five command forms, Vitest off/on with `vitest.config.ts` when on, node:test and pytest counts independently 0/1/2/10/40, and slow tier absent/uncounted with policy off/7 files with policy off/7 files with policy on: 1,000 cells. Project `i` is named `project-i`, with glob `test/project-i/**/*.test.ts`. Commands:

1. `squeal` (Claude Code).
2. `node --disable-warning=ExperimentalWarning "/opt/squeal/dist/cli/squeal.mjs"` (Codex's actual command format, short installation path).
3. `node --disable-warning=ExperimentalWarning "/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.207/dist/cli/squeal.mjs"` (Codex, cache path).
4. `"/usr/bin/node" --disable-warning=ExperimentalWarning "/opt/squeal/dist/cli/squeal.mjs"` (Pi/OpenCode command format).
5. `"/home/agent/.nvm/versions/node/v24.21.0/bin/node" --disable-warning=ExperimentalWarning "/opt/squeal/dist/cli/squeal.mjs"` (Pi/OpenCode, full Node path).

Exactly two cells lose project text, both command 2, Vitest on, zero node:test projects, seven required slow files:

| pytest projects | 0.1.206's pytest coverage | Candidate's pytest coverage | Total chars, before → after |
| --- | --- | --- | --- |
| 1 | `pytest project "project-0" (test/project-0/**/*.test.ts)` | `pytest (1 project)` | 1476 → 1499 |
| 2 | `pytest projects "project-0" (test/project-0/**/*.test.ts) and 1 more` | `pytest (2 projects)` | 1488 → 1500 |

Both gain the full command 2 before `run --slow --wait 60000`, where 0.1.206 said `the CLI's`. Both lose the name and glob of `project-0`; the second changes the remaining-project count's wording too. No other tested cell loses a named project; none loses an existing path-wait instruction. With no slow tier or the policy off, output is byte-identical. These are the exact affected cells of this bounded matrix, not an assertion about all possible path/project lengths. A wider synthetic command-length sweep also reproduces the same priority boundary for node:test and mixed coverage.

One-worker repair: choose the old coverage/naming combination using the previous policy-on sentence's budget, then substitute the exemption text and admit any optional path-wait sentence only if that same combination fits. Add a comparison regression at these boundary cases; the existing test proves sentence length, not preservation of the selected coverage. Alternatively the coordinator can explicitly accept the unchanged loop's trade-off and correct the claim in the worker notes.

## Notes

### N1 (proven limitation, accepted): the watcher can still be processing an edit when Stop reads the store

`src/harness/shared/no-edit.ts:15`, `src/harness/shared/stop-slow.ts:122`, `src/core/watcher/debounce.ts:5`. A disk edit not yet recorded as a revision reads as no edit. Both entries can therefore allow a rapid first-edit/Stop sequence while slow files are not current. The nominal debounce is 100 ms quiet/500 ms maximum; those timer settings are not a hard wall-clock bound on watcher delivery, queued processing or store contention.

**Acceptable for this candidate; no additional guard is required for the amended D9 contract.** The human-approved section explicitly defines the exemption by stored revisions and documents the debounce limitation. The exemption supplies no claim that slow tests passed, and the primer still tells an agent that edited to await them. Do not justify safety by assuming the model's final message always takes more than 500 ms: that is not guaranteed. If the product later promises that every disk edit is seen before Stop can exempt it, it needs a watcher flush/settlement acknowledgement before the decision; a fixed sleep alone would not establish that guarantee.

### N2 (proven existing boundary): first registration means the first retained registration

`src/core/delivery/registered.ts:183`, `src/core/types/store-records.ts:229`. Within the existing parked-registration retention, a returning consumer keeps its original `since`; gaps, another session's revision and a daemon replacement cannot create an exemption. Once its parked registration has expired after 12 hours, existing delivery semantics start a fresh registration at the latest revision. The source probe confirms that the same identifiers can then qualify as unchanged again. This is the existing lifecycle boundary, with a regression already in `test/delivery/registered.test.ts` ("starts over after the consumer expiry"), not a new blocker. Read D9's unconditional first-registration wording within that retention contract. Preserving an edit marker across expired consumer lifetimes would be a separate lifecycle change.

## Nits

None.

## What fits

- **004-67 store facts:** `unchangedSinceRegistration` reads only the stored registration, daemon start identity and latest worktree revision, inside each caller's transaction. Missing registration or scan evidence, a different daemon, or any newer revision returns false. It does not trust the agent's claim or subtract revisions attributed to another session. A still-registered consumer keeps `since`; an ordinary unregister/register cycle takes up the parked `since` and does not erase edits.
- **004-67 Stop seam:** the 2 s entry exempts only `MAIN_AGENT`, in the same transaction as its header and policy decision, covering Pi/OpenCode and a missing/untrusted waiting entry. The waiting entry checks after its handoff and before waiting. SubagentStop retains its immediate slow block. The new fixture order makes revision 1 an edit after registration; both-entry regressions cover no edit, one edit and a changed daemon. Known-failure and full-suite policies retain their own decisions.
- **004-67 instruction surfaces:** the policy-on primer states the requirement starts once a file changes, remains within 1,500 characters in the comparison matrix, and retains the step/criterion and Stop behavior. Off is unchanged. The three shipped skills' step 4, commands and policy agree. OpenCode has no fourth skill copy; the board/brief's reference to four does not denote a missing existing file. 004 and 005 status amendments record the decision.
- **004-66 S1:** `7b6f53e4` is the cherry-pick of board-referenced `8c7c195c`. The socket callback records the stale age supplied at probe start when it confirms liveness; a fresh next read does not clear that evidence. The new `watchDaemon` regression uses a real socket, allows the callback to finish, recovers the heartbeat before another stale read, and checks both `alive` and `{ staleMs: 20000 }`. No change to verdict/quiet gating or the dead-daemon bound was introduced.
- **Integration:** all eight version files agree on 0.1.207. The independent suite passes the key-format guard and all other key tests, with the format/pin unchanged. Key-relevant sources were not changed by this range, so no re-pin was required.

## Inputs for the next wave

No blocking repair wave. S1 is a bounded primer-selection/text-test task, or an explicit acceptance of the naming priority. Keep the 1,500 cap, both Stop entries' store-fact checks, the main-agent-only exemption, retained registration provenance and the liveness callback's saved lapse. N1 is an accepted observation boundary; a strict disk-edit guarantee would need a separately designed watcher/hook handshake.
