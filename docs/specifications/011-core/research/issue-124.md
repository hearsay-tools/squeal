# Issue 124: validation hold before child startup

Treat this as a request for startup ordering across worktrees. Preserve the existing worktree-local stop contract. A parent stop does not hold a child by design. An explicit child stop can be placed before its first hook when the orchestrator exposes that interval. Live reproduction was skipped because load exceeded CPU count.

Examined 2026-10-28: installed Squeal **0.1.374**, Node **v24.22.1**; repository source at `b6e326e9ac1a35fcf27c9ff6bf28489551a090f6`. Scope: [issue 124](https://github.com/hearsay-tools/squeal/issues/124), spec 011 C6/C8/C9, related C1. No product, board, spec, status or skill edits.

| Question | Answer | Evidence |
| --- | --- | --- |
| Does a parent `stop --until-start` hold a new child? | No. The mark belongs to the parent's root ID. Child startup checks the child's ID. | **read in source code**, 0.1.374 |
| Is that a same-worktree hold violation? | No. C9 explicitly excludes other worktrees. No same-worktree violation was reported or observed here. | **read in official docs**, spec at the commit above |
| Does the installed build actually run a child's test in this case? | Not determined by experiment. The live probe skipped at load 25.0195 on 24 CPUs. The issue reports that it did. | **inferred**, 0.1.374; report and source agree, but no live result |
| Can the child be held before its first agent hook? | Source supports `squeal stop --until-start CHILD_ROOT` after worktree creation and before any hook. Live effectiveness was not tested here. | **read in source code**, 0.1.374 |
| Does startup already show an effective local stop? | Yes. Registration includes the stopped-until-start sentence. JSON status carries `daemon.stopped` and `daemon.untilStart`. | **read in source code**, 0.1.374 |

## Findings

1. **read in official docs — spec 011 at the source commit above.** C9's 2026-10-26 amendment says: “Its scope is the worktree: every session and harness in it, and no other worktree.” C1 gives each worktree its own daemon. C8 resolves an isolated agent's own root at startup. The parent's hold therefore makes no promise about a new child. C6 status reads the store without starting a daemon. The issue itself explicitly says it concerns a different worktree, and supplies no original startup JSON or exact primer. Its 13,956 current results, 455 pending files and file-length failure remain incident claims, not reproduced evidence.

2. **read in source code — installed 0.1.374, checked against the source commit above.** `worktreeIdFor(root)` hashes the root's real path. `markStopped` writes `daemonStopped` metadata under that ID. `heldStop` reads only that ID. `ensure` calls `stopHolds` with the current consumer's worktree before spawning. `startSession` ensures the daemon before registration and primer delivery. Thus a child agent's first prompt instruction cannot itself establish a hold before this startup path. The code has no parent-stop lookup on this path. The repository's existing test “holds in its own worktree only” explicitly expects the other root to be ensured. These tests were read, not run.

3. **read in source code — installed 0.1.374.** The explicit-root CLI accepts an existing worktree root and rejects missing paths or subdirectories. Even when no daemon answers, `stopCommand` calls `leaveStoppedMark`. That function writes against the target's worktree ID in the shared store. With a policy file but no store, `--until-start` creates the store to retain the mark. `heldStop` does not require a worktree row. Existing test source covers both a linked worktree with no row and a first SessionStart after a stop created a store. These are source checks, not a live workaround verdict.

   The available ordering is: create the child worktree; make its policy available if no shared store exists; run the following command; check stderr and read its status; only then launch or attach the agent:

   ```sh
   /home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal stop --until-start /absolute/new-child-root
   ```

   Read status from that child with the same CLI's `status --json`. Before startup, expect a down daemon with `stopped: true` and `untilStart: true`. Do not rely only on exit 0: `stoppedMark` can print a write error while `stopCommand` returns 0. A stop before the child exists is rejected. With neither policy nor shared store, no mark is stored; adding policy later would require another stop before the first hook. C9 also records that a hook already spawned during the stop window can validate until it exits. This workaround needs ordering before any startup hook, not merely a quick stop after launch. No Cezar capability to enforce this ordering was inspected or assumed.

4. **read in source code — installed 0.1.374.** `asStopped` adds the stop flags and the registration header says “The daemon is stopped until …; no edit or Git operation starts one”. A current start takes precedence in the display, per C9's review amendment. Local stop visibility already exists. Child inheritance or a pre-creation hold would be additional behavior requiring a scope decision; it is not implied by the current CLI.

## Experiment record and limits

**verified by experiment — environment and skip only, 0.1.374.** Commands run:

```sh
uptime
getconf _NPROCESSORS_ONLN
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --version
gh issue view 124 --repo hearsay-tools/squeal --json number,title,body,comments,url
git rev-parse HEAD
python3 docs/specifications/011-core/research/probes/issue-124/probe.py > docs/specifications/011-core/research/probes/issue-124/output.txt 2>&1
```

Initial load: `17.66, 13.08, 11.36`; CPUs: `24`; CLI: `0.1.374`. The probe checked load again immediately before fixture creation, at `2026-10-28T20:04:29Z`:

```text
{"time": "2026-10-28T20:04:29Z", "load1": 25.01953125, "cpus": 24}
SKIPPED: one-minute load exceeds CPU count
```

Exit 1 is the probe's explicit load skip. No synthetic repository, worktree or daemon was created, so there was nothing to clean. No existing held worktree was started or restarted. No external Cezar repository was accessed. No repository tests or full suite were run or requested. Session-provided inherited test counts do not verify this finding.

The retained [throwaway probe](probes/issue-124/README.md) specifies a parent hold, an unheld child, and a preheld child. It invokes the installed Codex SessionStart directly, uses one harmless `node:test` arithmetic check, and would check marker writes plus daemon state. It was syntax-checked only; its live branch is unexecuted. It does not reproduce the original Vitest file-length failure, inherited counts, namespace restrictions, or Cezar's actual worker launch sequence.

## Recommendation and open question

**inferred — 0.1.374 and the current contract.** Keep this as an enhancement decision about who establishes the child hold before startup. Preserve `--until-start`'s local scope. Document the explicit child-root stop where an orchestrator can order it before hooks. The human must decide whether Squeal should add another scope or startup input when no such interval is available. This research authorizes no policy change. A later low-load synthetic run would confirm the runtime behavior and workaround; the original incident needs its startup evidence to establish exact counts and timing.

## Sources

- [Issue 124](https://github.com/hearsay-tools/squeal/issues/124), fetched body and comments (none).
- [`spec.md`](../spec.md): C1, C6, C8 and C9, especially the two 2026-10-26 stop amendments; [`status.md`](../status.md): rows 011-254 and its repair.
- `src/core/fs/git-layout.ts:48`; `src/core/delivery/stopped.ts:46` (`stoppedMetaKey`, `markStopped`, `heldStop`, `stopHolds`); `src/harness/shared/ensure.ts:70`; `src/harness/shared/session.ts:36`; `src/harness/codex/handlers.ts:35`.
- `src/cli/stop.ts:47` and `:169`; `src/cli/stopped-mark.ts:39`; `src/core/status/status-detail.ts:90`; `src/core/delivery/header.ts:201`.
- Read only: `test/harness/stopped-until-start.test.ts:138`; `test/harness/stopped.test.ts:57`; `test/cli/stop-mark.test.ts:172`. No pass claim.
- Installed files under `/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.374/`: `dist/session-start.mjs:9334` and `:12152`; `dist/cli/squeal.mjs:82604` and `:82634`. SHA-256: session-start `dd72643b7c1bb933b1463c2d14a4b936482a7cb218fd3a2230acb8d589e58f60`; CLI `bfee2600a5de5d595ec1256e16ba9054e689e371d767a23d8d9a945863614bce`.
