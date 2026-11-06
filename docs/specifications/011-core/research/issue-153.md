# Issue 153: revision-zero Stop holds and slow environments

Keep the read-only policy decision with #150, and investigate Stop provenance and escaped environment processes separately.

## Scope and versions

Research only, 2026-11-06. Inspected checkout `50f399db24467437a5d3d7a9788a31514e8a0d41`, package and shipped CLI **0.1.407**, Node **24.22.1**, Vitest **5.0.3**, Linux, **24 CPUs**. Issue [#153](https://github.com/hearsay-tools/squeal/issues/153) reports parent 0.1.407 and a worker daemon command at 0.1.404. That does not establish the version of each Stop hook. Also read the local release-tag source at `squeal--v0.1.404` (`3b066c002`). No incident worktree, browser, Cezar environment or nested worker was run. All probes used the inspected checkout. No product change is authorized.

Initial one-minute load: **4.90**. Immediately before the synthetic probe: **3.74**. Before the two live cases: **3.68**, **3.54**. Each was below 24; each script checks this itself. Commands and raw observations are preserved under `docs/specifications/011-core/research/probes/issue-153/`. The probe work finished inside the 20-minute bound.

## Questions and verdicts

| Question | Tagged answer, version examined | Reproduction verdict |
| --- | --- | --- |
| 1. Can revision-zero, unchanged work be held for unfinished lint after stopping? | **verified by experiment**, 0.1.407: production `requiredStep` with synthetic registration/store inputs returns an open lint requirement when the daemon record is cleared, or when registration lacks completed-scan evidence. The same revision with completed-scan evidence and the same daemon is exempt. | Decision path reproduced synthetically. The actual requested-stop hook sequence, 827/2,875-file count and 21.6-second wait were not reproduced. |
| 2. Can a slow environment start without edits? | **verified by experiment**, 0.1.407 / Vitest 5.0.3: one fresh temporary repo under `lookup-then-run-missing` ran a slow file and its `globalSetup` at revision 0, with empty Git status. A separate fresh `lookup-only` repo listed that file as unknown/not run and never ran setup during the observation. | Small live reproduction under explicit run-missing policy; original admission cause unknown. No lookup-only breach reproduced. |
| 3. Does stop leave the environment alive? | **verified by experiment**, 0.1.407 / Vitest 5.0.3: stopping the running fixture invoked teardown and its detached child was no longer live. | Reported leak not reproduced. One cooperative setup/teardown pair is not proof about the incident server and watcher. |
| 4. Are these existing defects or policy requests? | **read in source code**, 0.1.407 and 0.1.404; **inferred**, same versions: no-edit exemption depends on observation provenance, and slow admission need not require an edit. Required lint waiting first shipped in 0.1.406. | A broader read-only exemption is a policy decision. Cleanup needs ownership and shutdown evidence before assigning a defect. |

## Evidence and interpretation

### 1. Stop provenance

**verified by experiment, 0.1.407.** `pnpm exec tsx docs/specifications/011-core/research/probes/issue-153/stop.ts` exited 0. It supplied one untouched pending ESLint check, revision 0, and a required lint group to the real decision functions. Results:

| Registration evidence | Current daemon | `unchangedSinceRegistration` | Required step |
| --- | --- | --- | --- |
| Scan completed at registration | Same daemon | true | none |
| No scan evidence at registration | Same daemon | false | open lint |
| Scan completed at registration | Cleared | false | open lint |
| No scan evidence at registration | Cleared | false | open lint |

The real formatter produced: `Squeal policy checks puts the lint group at stop and 1 lint check is not linted at revision 0: untouched.js. ` followed by `` `squeal run lint --wait` runs them and waits for their results. ``

**read in source code, 0.1.407.** `src/harness/shared/no-edit.ts:15` requires `seesEveryChange`; `src/core/delivery/registered.ts:125` requires the registration's `scanned` start time to match the currently recorded daemon. Clearing the socket makes `worktrees.get().daemon` null (`src/core/store/repos/worktrees.ts:185`), even though the database retains the last daemon's identity. `requiredStep` applies that exemption only to `MAIN_AGENT`, then reads open lint checks; it has no stopped-by-request exception. The waiting entry also checks the exemption, then waits until its bound or the daemon-down bound. This source explains how the synthetic state can follow a real stop; the probe did not run a Stop hook or write a stop mark. A Cezar worker must not be assumed to be a Squeal subagent: the incident consumer identity is unknown.

**read in source code, 0.1.404 and 0.1.407.** The 0.1.404 `stop-lint.ts` has `lint.blocking` for files that went to fail since registration; it explicitly excludes pending, stale and unknown. It has no required-lint open-check formatter. Spec 019 status records lint at `pause`/`stop` as row 019-45, shipped in **0.1.406**. Thus the issue's 0.1.404 daemon observation cannot alone explain the quoted unfinished-lint gate. A newer hook with an older daemon is a possibility, not a verified incident fact. Spec 017 D8's ordinary `lint.blocking` rule must not be confused with spec 019's required group.

**inferred, 0.1.407.** Revision 0 means no stored revision, not proof that no file changed before observation began. Exempting every revision-zero or stopped session would widen the existing exemption. The tradeoff is fewer holds versus retaining evidence about edits made outside daemon observation. A stopped daemon also cannot satisfy an open requirement; a separate decision is needed on whether its gate should remain blocking or become information.

### 2. Admission without edits

**verified by experiment, 0.1.407 / Vitest 5.0.3.** `node docs/specifications/011-core/research/probes/issue-153/live.mjs` exited 0. Each case created and committed a tiny isolated Git repo, linked this checkout's dependencies, ran the shipped `squeal start`, observed status, then ran `squeal stop <fixture>`. It invoked no `run --slow` or full-suite command. The only test waits five seconds; `globalSetup` starts a harmless detached interval process and teardown terminates it. Marks are inside `.git`, outside tracked inputs. No source files change after the fixture commit.

- `lookup-only`: after up to 7.5 seconds of polling, revision 0, one slow file `notRun: 1`, `pending: 0`, no setup mark, empty Git status.
- `lookup-then-run-missing`: revision 0, one slow file `pending: 1`, activity `running`, setup mark present, empty Git status.
- Synthetic `momentHolds` calls with no revision/no consumer returned true for `edit`, `pause`, `stop`; false for `commit`, `manual`. This tests the moment predicate only, not all queue/capacity admission gates.

**read in source code, 0.1.407.** `src/core/scheduler/bootstrap.ts` distinguishes baseline misses from work inherited from a predecessor, unrefined edits and unconfirmed failures. Lookup-only does not cancel all such work. `slow-trigger.ts` treats no revision as quiet. Spec 004 D2 permits continuous slow work and D9 permits a departure drain. The source and the run-missing observation agree. They do not establish which exception or policy admitted the incident's 90 slow files.

### 3. Cleanup

**verified by experiment, 0.1.407 / Vitest 5.0.3.** Both stop commands exited 0 with `Squeal daemon stopped`. Elapsed samples, including the script's 300 ms post-stop observation pause: **536 ms** for lookup-only, **581 ms** for run-missing. The latter recorded `setup`, then `teardown`; PID 2483845 was not live afterward. No fallback kill was needed. Temporary repositories were removed. Setup itself saw no `SQUEAL_DAEMON_CHILD` token, so this demonstrates cooperative teardown, not the token sweep independently.

**read in source code, 0.1.407.** `withSlowInstance.close()` awaits closing its lane instances. Spec 004 D2 also requires release on hold, on drain and after 60 seconds without another slow tier, subject to its selection rule. Spec 011 C9 requires stop completion evidence. C13 documents process-group/token cleanup and limits including detached processes without the marker. The fixture's teardown owns its child. Neither project-server ownership, an escaped watcher nor a failed teardown was reproduced. An incident `stop` exit code and process lineage are needed to distinguish incomplete stop, project teardown failure and processes outside Squeal's tracked ownership.

## Recommendation, related work and unknowns

**inferred from the evidence above, 0.1.407.** Keep the read-only startup policy with open **#150**. Preserve a separate Stop-provenance question in #153: it has a demonstrated decision path but lacks the incident hook version, effective `checks`/`lint`/`stop` policy, registration scan state and consumer identity. A blanket no-edit rule changes policy; it is not an established repair for a lookup-only breach.

**read in official docs (repository issues/specs), fetched 2026-11-06.** Open **#147** concerns stop still serving after its 60-second wait, unlike this probe's successful stop. Open **#78** covers environment release and named slow demand; its release work in 011-211 shipped in 0.1.325, but later reports remain. Link cleanup evidence there without claiming the server-survival report is an exact duplicate. #153 does not establish a known successful stop leaving a process covered by the existing ownership rules.

Outstanding incident evidence: exact Stop-hook version/path and full block text; effective startup/group policy; registration before/after scan; whether any other session edited the worktree; stop stdout/stderr/exit code; setup/teardown output; surviving server/watcher parent, process group and presence of the daemon marker. Do not collect or publish environment contents. No inference here authorizes a new read-only mode, a broader process kill or changes to existing holds.

## Sources and verification

- `gh issue view 153 --repo hearsay-tools/squeal --json body,url,state`; also fetched `gh issue view <150|147|78> --repo hearsay-tools/squeal --json number,title,state,body,comments`. [#150](https://github.com/hearsay-tools/squeal/issues/150), [#147](https://github.com/hearsay-tools/squeal/issues/147), [#78](https://github.com/hearsay-tools/squeal/issues/78). Incident assertions are reports, not verified facts.
- Repository source at [50f399db](https://github.com/hearsay-tools/squeal/tree/50f399db24467437a5d3d7a9788a31514e8a0d41): paths cited above; `src/harness/shared/stop-slow.ts`, `stop-required.ts`, `stop-lint.ts`; `src/core/state/required.ts`; `src/cli/stop.ts` and `stop-waits.ts`.
- `git show squeal--v0.1.404:src/harness/shared/stop-lint.ts`; release [0.1.404](https://github.com/hearsay-tools/squeal/tree/squeal--v0.1.404). No 0.1.404 runtime probe.
- `docs/vision.md`; 011 C8/C9/C10 and status; 017 D8 and status; 004 D2/D9 and status; 019 D1/D4 and status for the lint extension those files reference.
- [Probe scripts, commands and raw outputs](probes/issue-153/README.md). No product tests, full suites, e2e, browser environment or nested workers were launched. Squeal reports these throwaway scripts as untested because no repository test loads them; they were executed directly as research probes.
- Final affected check: `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/011-core/research/probes/issue-153/stop.ts docs/specifications/011-core/research/probes/issue-153/live.mjs docs/specifications/011-core/research/issue-153.md` exited **3** at revision 11: `No verdict: no test file's closure holds` the three paths; `Worktree: known failures 0; all 1471 test files current`. This is not a full-suite run. Direct probes exited 0; `node --check docs/specifications/011-core/research/probes/issue-153/live.mjs` and `git diff --cached --check` passed. Formatting used `pnpm exec biome format --write` on the two scripts; the synthetic probe also passed after formatting.

Coordinator integration: moved probes into the owning spec’s `research/probes/issue-153/` directory and adjusted imports and links. Commands above show the final paths; retained outputs came from the original root-level paths.
