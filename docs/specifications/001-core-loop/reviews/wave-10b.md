# Review: wave 10, 001-91 (task 001-92)

Reviewer task 001-92 for spec 001, 2026-10-07. Range `c2196e3..b5581e0`. In scope: the 001-91 commits `a1a1287` to `e1e6b89`, the dist rebuild `24bfdb2` (version 0.1.10), and the coordinator's e2e assertion fix `b5581e0`. I read them against the 001-91 brief in `tasks/wave-10.md`, D6 as amended, `lessons.md` defects 15 and 16, and the vision's honesty rules. The range also contains 001-90 (`squeal remove`, `a71005d`, `5cf4f2f`) and 001-87 docs. The brief does not ask for those, and I did not review them (N6).

The question: are the collapsed reports and the attribution true at every edge?

## Verdict

**FAIL at `b5581e0`.** Counts: 2 blockers, 2 should-fix, 6 nits.

- **The collapsed reports are true at every edge I probed.** I probed 6 recoveries beside 6 retired checks, a 6-to-6 tie, and 40 failures with 300 recoveries and 40 retired checks: 9,575 characters, with the overflow counted correctly. The list choice follows D6 in each case. The one weak spot is that grouping by file can cost as many lines as the names it replaces (N1).
- **"touches your changes" can name changes the agent did not make, and "none of your changes are in its imports" can be said of a failure the agent's own edit reaches.** It compares against the revisions after the registration revision, and two paths move or misplace that revision:
  - SessionStart `resume` overwrites it, though the consumer was never unregistered (B1).
  - A session that spawns the daemon registers before the daemon's start revision. That revision records what changed while no daemon ran, and it is then counted as the agent's (B2).
  - `compact` keeps the revision.
- **The install label calls a removal an install (S1).** During `npm ci`, or after `rm -rf node_modules`, one header says both "No dependencies are installed" and "These results follow a dependency install".
- **The closure the attribution reads is repository-wide (S2).** The newest closure any worktree stored wins. In a parallel-worktree run, a test whose imports differ between branches can be read against another branch's imports.
- **A timeout recorded by 0.1.9 has no load field, and 0.1.10 reads it as absent:** no load line, no error. A test file whose closure was never collected gets neither attribution line. Both are as D6 says and are tested.

## Verification

The branch HEAD is `8a8d465`, one commit past the candidate. That commit changes only `docs/board.md` and `tasks/wave-10.md`, so the code is the candidate's. I ran everything at `8a8d465`.

```
$ git rev-parse HEAD
8a8d465f308dc34479127989b688a8a071bdc0ae
$ git diff --stat b5581e0 HEAD -- . ':!docs'
(empty)
$ npm ci
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts ... (exit 0)
$ npm run lint
Checked 367 files in 91ms. No fixes applied.
$ npm run typecheck
tsc --noEmit   (no output, exit 0)
$ npm run build
(exit 0)
$ git status --porcelain
(empty: committed bundles match the build)
$ npx vitest run          (load average 6.9 to 11.9 on 24 cores)
 Test Files  129 passed (129)
      Tests  980 passed | 7 skipped (987)
   Duration  52.75s
```

I ran the probes below in a throwaway `test/delivery/probe92.test.ts` against `createDelivery` and `formatDelta`, and deleted it before committing.

## Blockers

### B1. SessionStart `resume` resets the registration revision, so a failure the agent's earlier edit reaches says "none of your changes are in its imports" (proven)

`src/harness/claude-code/hooks/session-start.ts:54-60`: on `resume`, the main agent's own consumer is spared by the sweep (`except: context.consumer`) and stays registered. Then `delivery.register` runs, and `src/core/delivery/delivery.ts:204` `tellRegistered(store, consumer, header.revision)` overwrites the revision the consumer registered at. The resumed conversation still holds every edit the agent made before the resume, but those edits are no longer "your changes".

Probe: register at revision 1, closure `[src/a.test.ts, src/x.ts]`, the agent edits `src/x.ts` (revision 2), `register` again as `resume` does, then the test fails at revision 3 (README edit). The delivered block:

```
FAIL  src/a.test.ts > a
      PASS -> FAIL, seen by Squeal's run at revision 1
      expected 1 to be 2
      at src/a.ts:3:5
      none of your changes are in its imports
```

Concrete case: the agent edits `src/x.ts`, Claude Code exits before the run lands, the user resumes, and the result arrives after the resume.

This breaks the row's outcome ("says for each failure ... whether the agent's changes reach it") and the human's decision ("changed since the consumer was registered"): the consumer was registered at revision 1 and never unregistered. `compact` is fine. A registered main agent gets the primer alone (`session-start.ts:51`) and keeps its revision.

**Fix (one worker, `src/core/delivery/`):** in `register`, keep an existing registration revision when the consumer is already registered, and write it only when no slot exists. `forget` already clears it on unregister and expiry, so a fresh registration still starts from now. Test: register, edit a closure path, register again, fail. The failure says "touches your changes: src/x.ts". Then repeat it through the `sessionStart` handler with `source: "resume"` and `"compact"`.

### B2. A session that spawns the daemon registers before the daemon's start revision, so changes made while no daemon ran are reported as "your changes" (proven by code order, probe at the delivery level)

Order:

1. `src/core/daemon/daemon.ts:130` `#register()` writes the heartbeat synchronously.
2. `:142` `#run()` then awaits dynamic imports before the scheduler's `bootstrap` (`src/core/scheduler/keying.ts:97`) reconciles the cached paths. Its doc: "what changed while no daemon ran becomes a revision", trigger `start`.
3. SessionStart's `settle` (`src/harness/claude-code/ensure.ts:50`) returns on the heartbeat. `register` therefore records the revision from before that start revision.

After that, `changedAfter` (`src/core/delivery/attribution.ts:38`) includes the start revision. Probe: register at revision 1, closure `[src/a.test.ts, src/x.ts]`, append a `start` revision changing `src/x.ts`, fail. `changesInClosure` is `["src/x.ts"]`.

Concrete case: the daemon idles out overnight. The human runs `git pull`, or switches branches, and starts a session. Every failure whose imports include a pulled file then says "touches your changes: <pulled files>". Those changes came from someone else, before the session existed. This breaks the human's decision ("changed since the consumer was registered") and the vision's evidence rule, since the agent is pointed at the wrong cause.

**Fix (one worker; `src/core/delivery/` plus one read of the worktree record, or a hook-side wait):** the registration revision must not precede a start revision whose changes predate the registration. Two options; the worker picks one and states it in D6:

- **(a)** Record the daemon's `startedAt` with the registration revision in the slot. In `changedAfter`, skip the first `start` revision created after that `startedAt` when the daemon had not yet produced it at registration.
- **(b)** Have SessionStart's `settle` also wait, within its budget, for the spawned daemon's bootstrap to finish (a store marker the daemon writes after `bootstrap`). If the wait runs out, record no registration revision, so no attribution line appears for that consumer.

Test: register on a heartbeat-only daemon record, append a `start` revision changing a closure path, then fail. Neither "touches your changes" nor "none of your changes" may name that path as the agent's.

## Should-fix

### S1. "These results follow a dependency install" on a removal (proven)

`src/core/delivery/provenance.ts:92`: `installSentences` labels any header whose `changedPaths` contain an installed lockfile, including a deletion (`newHash: null`, which `diffCandidates` records when the lockfile goes). `npm ci` deletes `node_modules` first. The failures that follow ("Cannot find package") come with this header (probe output):

```
... No dependencies are installed in this worktree; failures that cannot find a package are expected until an install. These results follow a dependency install (node_modules/.package-lock.json changed).
```

The second sentence states an install that has not happened. D6 words it as "a header whose changed paths include an installed lockfile". The code matches the spec, and the spec overclaims. **Fix:** say "follow a dependency install" only when the lockfile's newest change in the range has a `newHash`, and say nothing (or "follow a removal of installed dependencies") when it was deleted. `changedSince` returns paths only, so the reader needs the `FileChange`. Amend D6 to match. Test: header after a deletion revision of `node_modules/.package-lock.json`.

### S2. The attribution reads the newest closure from any worktree (plausible)

`attribution.ts:85` reads `store.testFiles.get(ref)`. The test-files table is repository-wide, "newest closure wins" (`TestFileRecord`, D8), and `updatedBy` says which worktree wrote it. Worktree A's test may import `src/new.ts`, which A changed, while B's branch version does not import it. If B's daemon stored its closure after A's, A's failure says "none of your changes are in its imports", which is false. An inherited result has the same exposure: the stored row can come from a third worktree. D6 says "its test file's stored closure", so this is spec-conformant. It is plausible rather than proven because it needs two branches whose imports differ and B storing last, which is the normal shape of a coordinator wave.

**Fix:** use the stored closure only when `updatedBy === consumer.worktreeId`, or when the origin worktree's key matches. Otherwise omit both lines, which D6 already reads as not known. Alternatively, ask the daemon for its in-memory `KeyIndex.closure` (not reachable from hooks). Test: closure stored by `OTHER` with `updatedBy: OTHER`, then the failure has no `changesInClosure`.

## Nits

- **N1.** `collapse.ts:35` `nameLines` groups any list of more than five checks by file, even when every file holds one check. 6 recoveries in 6 files print `1 in tests/r0.test.ts` six times: as many lines as the names, but without the names. Group only when grouping saves lines. This follows the human's wording, so it needs their consent.
- **N2.** `attribution.ts:62`: `loadOf` searches only the 5 newest results of the check across all worktrees. With several worktrees running the same test, the timeout's own result can fall outside those 5 and the load line disappears. The gap is silent, not false. Filter by worktree in SQL (`listForCheck` has no worktree argument), or raise the limit.
- **N3.** `changedAfter` (`attribution.ts:38`) issues one `revisions.get` per revision since registration, inside the delivery's write transaction. Probe: 3,000 revisions since registration cost 11 to 30 ms per delivery with a failure, growing linearly over a long session. Use one range query.
- **N4.** A consumer that expires (`WAITERLESS_EXPIRY_MS`, 10 min with no waiter) and re-registers on UserPromptSubmit starts its attribution from the re-registration. Same conversation, same effect as B1, but narrower. If B1 keeps the slot only while registered, this case stays. State it in D6 or keep the slot across expiry.
- **N5.** `reports.md`: "Without either line, Squeal does not know the test's imports yet." The lines are also absent for a consumer registered by 0.1.9 or older, which has no registration revision, and that has nothing to do with imports. Add it.
- **N6.** Board: 001-90 (`squeal remove`, deletes `<common-dir>/squeal/` and temp directories) landed in this range with no review row. 001-92's brief names only 001-91. I am reporting this, not repairing the board.

## What fits (do not re-check)

- **Collapse.** Up to five recoveries are listed in full. Above five, one summary line plus the shorter list in lines, with ties going to the still-failing list. Retired checks collapse on their own with the same rule. When nothing still fails, "still failing: 0" wins. An unknown `stillFailing` shows the changed list. Probes, 6 recovered and 6 retired with 2 still failing: two one-line groups. A 6-to-6 tie across 6 files: the recovered list (6 lines against 7), as the rule says.
- **Cap.** 40 failures, each with touches and load lines and long summaries, plus 300 recoveries and 40 retired checks. 9,575 characters; 17 failures are shown. "Not shown: 363 more changed checks (23 FAIL, 300 PASS, 40 RESOLVED)" adds up. The `Full output` line is last.
- **Seen line.** "seen by Squeal's run at revision N", plus ", at start (baseline)" for baseline entries. Inherited entries name the origin root and commit with this worktree's inheritance revision: `observedAt` is the applied revision for inherited results (`derive.ts:99`). The baseline title was reworded. The e2e assertion (`b5581e0`) matches the format.
- **Inherited attribution** compares against this worktree's changes since registration, as decided (aside from S2's closure source).
- **No closure stored, or no registration revision:** neither line appears (tested).
- **Load.** `withLoad` runs per test result in `onTestCaseResult`, only on `Test|Hook timed out in Nms`, and not on Windows. `loadAverage` is stored in the failure-text JSON. The fingerprint excludes it (`describeFailure` uses the first error line and location), so a re-run under another load is not `fail-changed`. A 0.1.9 failure text without the field reads as absent (tested). Each distinct load stores a new `failure_texts` row, which is acceptable.
- **No-dependencies note.** It appears only beside a failure, only once the daemon has hashed files, and only when no installed lockfile is among them. `locateLockfile` never looks above the worktree root, so the note and the fingerprint agree. Mid-install it is true; S1 is about the other sentence.
- **Store and types.** Every addition is additive. The registration revision lives in a `meta` slot, written in the registration's transaction and cleared by `forget`. No schema step.

## Inputs for the next wave

- **The B1 and B2 fix row** owns `src/core/delivery/attribution.ts` and `delivery.ts` (register path), and for B2(b) also `src/harness/claude-code/ensure.ts` and one daemon marker in `src/core/daemon/`.
  - Call order in `register`: read the existing registration slot before `tellRegistered`, and write it only when there is none.
  - For B2(a), the slot value becomes `{ revision, daemonStartedAt }`. `registeredRevision` must still accept a bare number, the 0.1.10 form, from consumers registered before the fix.
  - Budget: SessionStart p95 as in `status.md` (65 ms). B2(b) waits only inside `SPAWN_SETTLE_MS`.
- **The S1 fix** needs `FileChange.newHash` for the lockfile. Either read the revision records in `installSentences`' caller, or add a `dependenciesRemoved` or `lockfileChange` field to `StatusHeader` beside `dependenciesInstalled`. Amend the D6 sentence.
- **The S2 fix** needs only `TestFileRecord.updatedBy` (already stored).
- **Tests to add:** resume and compact through the `sessionStart` handler; a `start` revision after registration; a lockfile deletion header; a foreign `updatedBy` closure.
- **Still missing:** an attended check that "touches your changes" points at the right file in a real session. 001-87's fixture with a pulled branch would show B2 directly.
