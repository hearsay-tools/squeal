# Issue 75: repeated handover notices

Keep the issue open for the missing runtime evidence. **Not reproduced, because the isolated release-bundle probes did not alternate handover and recovery during one unresolved upgrade.** This does not disprove the reported session.

## Question and scope

[#75](https://github.com/hearsay-tools/squeal/issues/75) reports repeated read-only boundaries alternating “a daemon is validating again” and “the daemon is handing over”, always at revision 0 and from 0.1.260 to 0.1.261. Its handover timestamps change across about three minutes. The report contains no daemon process evidence. Read with:

```sh
gh issue view 75 --repo hearsay-tools/squeal --json number,title,body,comments,url
```

Research ran on 2026-10-22, starting at 13:07 UTC. The first safety check was `cat /proc/loadavg; getconf _NPROCESSORS_ONLN`: **11.79 10.91 12.58**, **24 CPUs**. The one-minute load was below the CPU count. Each probe checked it again. No dependency setup, product build, broad test run or product change was made.

The checkout and `origin/main` were `8e38d7dc3dcfcd696bdacb2571e59a1cfa3dda8c`, package version **0.1.263**. The experiment used the actual committed Codex bundles from:

- **0.1.260**, tag `squeal--v0.1.260`, commit `0f4cd7bb3f0478e78496d11eae86b1bd5dfec649`.
- **0.1.261**, tag `squeal--v0.1.261`, commit `40b721f0967ed4f32cefd6075680cfaa195eaff4`.

Host runtime: **Node v24.21.0, Linux**. Each experiment had its own scratch Git repository, store, lock, session ID, runtime directory and config directory. Environment variables were limited to PATH and those scratch directories. Squeal used its normal socket fallback under `/tmp/squeal-1001`, keyed to the unique fixture root. Cleanup selected only daemon argv containing that exact root. It did not stop or alter other sessions.

## Answers

| Question | Answer and evidence tag |
| --- | --- |
| Do concurrent read-only hooks reproduce the reported alternation? | **Verified by experiment, 0.1.260 → 0.1.261:** no. Eighty new hooks and eighty mixed old/new hooks completed their upgrades without a handover or recovery delivery. |
| Does a blocked handover repeat its notices? | **Verified by experiment, 0.1.260 → 0.1.261:** the delayed SIGSTOP probe delivered one handover notice, then one recovery after SIGCONT. Eighty-two of 84 boundaries were silent. Only one claim value appeared in the sampled store snapshots. |
| Did recovery precede successor registration? | **Verified by experiment, 0.1.261:** not in this probe. The recovery followed release of the old daemon. The final snapshot recorded 0.1.261 and no handoff claim. No test execution was proved by that registration. |
| Does the source guarantee a notice only when successor ownership changes? | **Read in source code, 0.1.261:** liveness delivery compares `alive`/`down`, derived from heartbeat freshness. `withStopping` adds handover detail without changing that state. This is not an explicit comparison of successor identities. It is a lead, not a demonstrated cause. |
| Is issue 75 already covered by the board? | **Read in source code, origin/main at the SHA above:** no `gh-75` or `#75` row was present. Rows 011-32 and 011-34 shipped in 0.1.261 and cover claims and handoff status. Row 011-110 covers an extra successor from `start`; these probes never called `start`. |

## Commands and observed output

Run from the repository root. The probe extracts the shipped bundles with `git archive squeal--v<version> plugins/codex/dist` and `tar -x -C <scratch-version>`. It starts `node --disable-warning=ExperimentalWarning <0.1.260-dist>/cli/squeal.mjs daemon <fixture-root>`. It registers with that version's `session-start.mjs`, then runs `post-tool-use.mjs` with JSON on stdin. Each input uses the same session, the fixture cwd, `PostToolUse`, `Bash`, and the read-only command `cat README.md`. The probe supplies the read response; it makes no source edits during the hooks.

```sh
node --disable-warning=ExperimentalWarning docs/specifications/011-core/research/probes/issue-75/probe.mjs natural > docs/specifications/011-core/research/probes/issue-75/natural.jsonl
node --disable-warning=ExperimentalWarning docs/specifications/011-core/research/probes/issue-75/probe.mjs mixed > docs/specifications/011-core/research/probes/issue-75/mixed.jsonl
node --disable-warning=ExperimentalWarning docs/specifications/011-core/research/probes/issue-75/probe.mjs blocked-delay > docs/specifications/011-core/research/probes/issue-75/blocked-delay.jsonl
node docs/specifications/011-core/research/probes/issue-75/summarize.mjs docs/specifications/011-core/research/probes/issue-75/natural.jsonl docs/specifications/011-core/research/probes/issue-75/mixed.jsonl docs/specifications/011-core/research/probes/issue-75/blocked-delay.jsonl
```

| Mode | Start UTC | Load / CPUs | Boundaries | Delivery | Largest hook time |
| --- | --- | --- | --- | --- | --- |
| natural | 13:12:08 | 6.77 / 24 | 20 batches × 4 new hooks | All silent | 105 ms |
| mixed | 13:09:53 | 4.78 / 24 | 20 batches × 2 old + 2 new hooks | All silent | 74 ms |
| blocked-delay | 13:11:38 | 4.85 / 24 | 80 concurrent new hooks, then 4 serial hooks after release | One handover, one recovery | 87 ms |

Every hook exited 0, with no timeout signal. Each fixture's final `git status --porcelain` output was empty. No revision row was created; delivered headers called this revision 0. The fixture has no test files and uses `baseline.onStart: "lookup-only"`. The final read of each of the five probe stores found `runs: 0` and `daemon_socket: null`. Process inspection found **Live probe daemons: 0**.

In `blocked-delay`, the probe sent SIGSTOP to its own old daemon 10 ms after its shutdown diagnostic. It held that process from 13:11:39.083 to 13:11:53.565, crossing the 10-second heartbeat grace. The sampled claim retained `at: 1792674699071` and `boundAt: 1792674829071`. The exit note's time was 2 ms later than the claim's time. The exact delivered texts were:

```text
SQUEAL · the daemon is handing over at revision 0
Revision 0: no check pending, stale or unknown. The daemon is handing over from 0.1.260 to 0.1.261 since 2026-10-22T13:11:39.073Z; 0.1.261 serves once the old daemon's lock frees; results are as of revision 0.

SQUEAL · a daemon is validating again at revision 0
Revision 0: no check pending, stale or unknown.
```

The first arrived at 13:11:50.266, boundary 6; the second at 13:11:54.631, boundary 80. [results.txt](probes/issue-75/results.txt) preserves the extracted outputs, identities, claims and final records. [probe.mjs](probes/issue-75/probe.mjs) is the throwaway reproduction driver.

Two earlier diagnostic runs do not support the primary verdict. The first had an invalid `nodeTest` object instead of an array; it warned and used defaults. Its 80 boundaries were silent. The first blocked run paused the daemon during a store write: reads saw the exit mark but not its note, hooks took about one second and returned silently. A held writer is inferred from those observations, not independently measured. The delayed pause above avoided that condition. Both runs were cleaned up.

## Limits and recommendation

**Inferred from the experiments and source at 0.1.261:** concurrent hooks alone did not cause this report. Keep the case unconfirmed. Do not choose a product fix from these results.

The missing discriminator is whether the reported notices span one old daemon incarnation or repeated 0.1.260 daemon starts. On a future occurrence, capture the daemon version, start token, heartbeat, handoff claim, exit note and the executable path of each successor, with the hook version and consumer ID. Capture these from the affected session only with its owner's authorization.

The probe did not run a real Codex session, install an upgrade, delete a runtime, exercise `PLUGIN_DATA` retained copies, run a test tier, hold a handoff past its 130-second bound, or reproduce shared-store contention from other worktrees. Each main mode ran once. The synthetic pause is not evidence that the original daemon was paused. Snapshot sampling between batches cannot prove every intermediate state. The original runtime paths, consumer IDs and daemon incarnations remain unknown.

## Sources and contract

- [Issue 75](https://github.com/hearsay-tools/squeal/issues/75), fetched through `gh`; no comments at read time.
- `docs/process.md` (bounded documentation-only triage), `docs/vision.md` (silence, trustworthy state), `docs/styleguide.md`, and `git show origin/main:docs/board.md`.
- [011 spec](../spec.md), C5/C6/C8/C9/C10, and [status amendments](../status.md), notably 011-32/011-34 and 011-110. C8 says “liveness is told once per change”; C9 requires one claim per handoff.
- [002 Codex adapter](../../002-codex-adapter/spec.md), D3–D5: PostToolUse shares the core delivery view; concurrent boundaries must consume news once. [005 adoption](../../005-agent-adoption/spec.md), D3: retained runtime copies are an untested upgrade path here.
- [0.1.261 source](https://github.com/hearsay-tools/squeal/tree/40b721f0967ed4f32cefd6075680cfaa195eaff4): `src/harness/shared/ensure.ts` (`handOver`), `src/core/delivery/handoff.ts` (`claimHandoff`), `src/core/delivery/liveness.ts` (`livenessChange`), `src/core/delivery/delivery.ts` (transactional delivery), `src/core/status/stopping.ts` (`withStopping`, `claimed`), and `src/harness/codex/kept.ts` (version-specific CLI selection).
