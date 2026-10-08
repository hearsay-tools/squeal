# Wave 12 review: 001-122

## Verification

Reviewed on Linux, Node 24.21.0, at clean HEAD `7940dd50fd831be69b70176ff57c4b19a33e63b1`, before writing this file. The dispatch names build `dbeb862`; HEAD differs by a documentation-only commit (N1). `git diff dbeb862 HEAD -- src test plugins package.json package-lock.json` produced no output. The landed implementation commits are `c6f43cc`, `ff2f444`, `a31ad92`, `b530416`, cherry-picked from `17d7e19`, `1dc7af6`, `c079bfa`, `10e0bcc`; the bundle/version commit is `dbeb862` (0.1.32).

The following gate ran once. Install, lint, typecheck and build succeeded. Build left `git status --short` empty: neither plugin's committed bundles drifted. The full suite reported 204 passing files, 1 skipped file, 1,687 passing tests and 10 skipped tests. These are results at the actual clean HEAD, not an exact-checkout verification of `dbeb862`. Under the reviewer rule, verification at the supplied SHA is **unverified**; product and test bytes are identical, as checked above. No check result is a finding against the wave.

```text
$ npm ci
added 56 packages, and audited 57 packages in 2s

18 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
```

```text
$ npm run lint
> squeal@0.1.32 lint
> biome check .

Checked 532 files in 263ms. No fixes applied.
```

```text
$ npm run typecheck
> squeal@0.1.32 typecheck
> tsc --noEmit
```

```text
$ npm run build
> squeal@0.1.32 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.32 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
```

```text
$ npx vitest run
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/435f4dcc-8f6c-4076-86f6-3226c49e8390

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/435f4dcc-8f6c-4076-86f6-3226c49e8390/test/fixtures/scheduler/.tmp/36f4629f-871f-4e05-9bc6-ec7512c72561/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/435f4dcc-8f6c-4076-86f6-3226c49e8390/test/fixtures/scheduler/.tmp/b8ffe9c2-9f8f-4a0d-b3df-6b1ba9a4e037/main/.git/worktrees/staged/gitdir

 Test Files  204 passed | 1 skipped (205)
      Tests  1687 passed | 10 skipped (1697)
   Start at  14:27:00
   Duration  112.03s (tests 96%, transform 2%, import 1%)
```

## Verdict

**PASS at `7940dd50fd831be69b70176ff57c4b19a33e63b1`.** Zero blockers, one should-fix (proven), one nit (proven). No plausible product finding. Live interactive SIGKILL and an actual Cezar controller destruction remain unverified; successful substitute probes are described precisely below.

The departure path keeps a daemon while another consumer is registered, honors clear/resume during the grace, drops a dead or reused process identity, and finishes the tier before exiting. No proven break of a spec goal or the row's done-when was found. This is not a claim that every harness mode was validated.

## Blockers

None.

## Should-fix

### S1. Proven: 12-hour expiry skips the new harness/departure cleanup

Location: `src/core/delivery/expiry.ts:54`, including the early return at line 56.

The new `drop()` path removes the per-consumer harness slot and stamps the worktree's latest departure. Explicit unregister, waiterless expiry and heartbeat process removal all use it. The retained 12-hour branch instead calls `store.consumers.expire()` directly and only removes lock files afterwards. Thus the new process slot survives for a consumer that no longer exists, and this removal has no departure stamp.

D10: "the latest departure every unregister stamps in `meta`, so a session that registers and ends between two counts counts too"; the 12-hour expiry remains the backstop. A probe created a store, registered a consumer at time 1, recorded a harness identity, then called the exported `expireConsumers(store, 13 * 60 * 60 * 1000)`:

```json
{"expired":[{"worktreeId":"0123456789abcdef","sessionId":"expired","agentId":"main"}],"consumer":null,"harness":{"pid":4242,"startTime":1,"pidNamespace":"ns"},"departure":null}
```

The proved failure is stale new metadata and an omitted stamp. Normal 250 ms presence polling will already have observed a 12-hour-old consumer, so this does not establish a lifetime violation in the normal path and is not blocking. Prior omissions in the old expiry implementation are outside this review; this finding concerns the newly introduced harness slot and departure contract.

One-worker fix: in the same transaction that expires consumers, apply the new cleanup/stamp to every removed consumer, before the optional `locksDir` early return. Preserve the cutoff and free-lock behavior. Add a public-interface regression asserting that the consumer and `harnessOf()` are absent and `lastDeparture()` equals the expiry time, both with and without `locksDir`. Own `src/core/delivery/expiry.ts` and its expiry tests. No schema or harness adapter change is needed.

## Nits

### N1. Proven: checkout differs from the dispatch candidate

Location: `docs/specifications/001-core-loop/tasks/wave-12.md:67`; observed `git rev-parse HEAD` above.

The dispatch names build `dbeb862`; this worker starts at `7940dd5`, the next documentation commit. Its delta is board, task, research brief and lessons documentation; there is no product, test, bundle or manifest delta. The skill requires recording the mismatch. This is nonblocking. No board/status file was repaired.

Coordinator-sized fix: record the actual review base in the dispatch/result, or give the next reviewer the exact candidate checkout. No product worker is needed.

## Discriminating probes

All probes used fresh owned repositories and private runtime directories. Shipped hook and CLI bundles ran directly, without `SQUEAL_CLI`. Temporary scripts were deleted before committing. Cleanup targeted only processes launched by these probes, never a host-wide process-name kill. The prior worker's reported host-wide kill is not evidence for or against this candidate.

### Both shipped bundles: consumers, grace and process death

A persistent Node process stood in for the harness and launched hook bundles as children. The recorded identity came from the actual ancestor walk, not injected `HookDeps`. Two independent harness processes used one fixture/worktree. Each plugin completed this sequence:

1. Register two main sessions plus one subagent. SubagentStop leaves both main consumers and the same daemon alive after more than 3 s.
2. Register a subagent under its own session id and send its SessionEnd. Both unrelated main consumers remain. This proves session-id isolation, not that a subagent normally emits that shape. Recorded normal subagents end with SubagentStop.
3. End the first main session. After more than 3 s the daemon still serves the second.
4. End the last session, then start a new id with `source: clear` after 150 ms. The same daemon survives beyond the grace.
5. End that id and resume it from the other harness process after 150 ms. Kill the former process. After a heartbeat the resumed consumer and daemon remain.
6. SIGKILL the current harness without SessionEnd. The consumer is removed and the daemon exits.

Console evidence:

```jsonl
{"name":"claude-code subagent-stop keeps main","consumers":[{"session_id":"s1","agent_id":"main"},{"session_id":"s2","agent_id":"main"}],"daemonPid":2223922}
{"name":"claude-code subagent SessionEnd with own session","consumers":[{"session_id":"s1","agent_id":"main"},{"session_id":"s2","agent_id":"main"}]}
{"name":"claude-code first of two sessions ends","consumers":[{"session_id":"s2","agent_id":"main"}]}
{"name":"claude-code clear within grace","daemonPid":2223922}
{"name":"claude-code resume onto new process","consumers":[{"session_id":"s3","agent_id":"main"}]}
{"name":"claude-code killed harness no SessionEnd","exitMs":5159,"consumers":[]}
{"name":"codex subagent-stop keeps main","consumers":[{"session_id":"s1","agent_id":"main"},{"session_id":"s2","agent_id":"main"}],"daemonPid":2241725}
{"name":"codex subagent SessionEnd with own session","consumers":[{"session_id":"s1","agent_id":"main"},{"session_id":"s2","agent_id":"main"}]}
{"name":"codex first of two sessions ends","consumers":[{"session_id":"s2","agent_id":"main"}]}
{"name":"codex clear within grace","daemonPid":2241725}
{"name":"codex resume onto new process","consumers":[{"session_id":"s3","agent_id":"main"}]}
{"name":"codex killed harness no SessionEnd","exitMs":5396,"consumers":[]}
```

### Actual Claude Code `-p` and Codex `exec`: SIGKILL during a long tier

Each fixture had one 14-second test that wrote external start/done markers. Its daemon was started from that plugin's shipped CLI. Claude Code loaded the local plugin with `--setting-sources project,local --plugin-dir <plugin>`. Codex used that plugin's SessionStart command via a per-invocation hook override, with the user's plugins disabled for the invocation. The reviewer did not inspect credentials or edit user settings.

After registration, the probe checked that the recorded PID was the launched harness or its descendant, waited for the tier's start marker, then killed that exact PID. Claude Code's record names `claude`; Codex's names the native child, not its npm launcher. Results include the file-level pass and test pass. Both exited 0 after the tier finished, with no consumers left:

```jsonl
{"plugin": "claude-code", "mode": "print", "recordedPid": 2355177, "harnessLauncherPid": 2355177, "daemonExit": 0, "exitMs": 14349, "tierFinished": true, "results": [["pass"], ["pass"]], "consumers": []}
{"plugin": "codex", "mode": "exec", "recordedPid": 2380585, "harnessLauncherPid": 2380534, "daemonExit": 0, "exitMs": 14848, "tierFinished": true, "results": [["pass"], ["pass"]], "consumers": []}
```

**Unverified:** live interactive SIGKILL for both harnesses. Direct pseudo-terminal and isolated tmux launches did not reach a registered session within their startup budget. They were cleaned up. The cause was not established; no product failure is inferred. The earlier research's interactive ancestor chains support the process-selection rule but are not fresh verification at this candidate. An attended TUI run reaching registration is still needed to close this coverage gap.

### Worker destruction while a tier runs

A persistent harness stand-in registered in a fresh linked worktree. During its 14-second tier, the probe SIGKILLed that harness and removed only that worker's root, leaving the main repository and common store intact. For both plugins the tier reached its external done marker, the daemon exited 0, the consumer was gone, and no pass was stored for the removed inputs:

```jsonl
{"plugin": "claude-code", "mode": "worker-destroy", "recordedPid": 2532176, "harnessLauncherPid": 2532176, "daemonExit": 0, "exitMs": 14174, "tierFinished": true, "results": [], "consumers": []}
{"plugin": "codex", "mode": "worker-destroy", "recordedPid": 2543672, "harnessLauncherPid": 2543672, "daemonExit": 0, "exitMs": 14336, "tierFinished": true, "results": [], "consumers": []}
```

This exercises the kill-plus-worktree-removal behavior of destruction. **Unverified:** the actual Cezar controller's destruction sequence was not invoked; this owned reviewer did not control another worker. Missing inputs correctly discard the tier's results under D5, rather than storing a pass for deleted files.

### PID reuse and fallbacks

The full suite's `test/daemon/departure.test.ts` uses a live PID with a different recorded start time and observes daemon exit while the process holding the PID stays alive. `test/delivery/harness-process.test.ts` also covers an actual zombie, SIGKILL, shared process identities and registration moved to a new identity before the removal transaction. Actual kernel PID recycling was not forced; reuse is emulated by a mismatching start time, as in the research.

No-process/no-namespace and foreign-namespace paths keep the expiry backstop. macOS remains outside this wave's verified platform, as the spec states.

## What fits

- **Honesty (vision, D5, D6, D10):** stopping waits for the current tier and clears the daemon record after runner close. A disappearing worktree produced no stored result under missing inputs. No new formatter or revision-classification path is introduced.
- **Shared seams (D8 to D10):** shared hook context passes the lookup to delivery; registration records it with the consumer in one transaction. Heartbeat checks only its worktree's consumers, once per identity, then re-checks that identity inside the removing transaction. A moved registration is kept. Meta slots use the existing consumer key; no schema change.
- **Session isolation (D9):** subagent unregister is separate from the parent. Two sessions keep the daemon until the last leaves. Resume re-records the process, clear bridges the grace. A live shared process does not replace per-session SessionEnd.
- **Departure (D10):** explicit unregister writes a departure even if the 250 ms count never saw registration. Presence survives timer restarts. The grace applies after the last consumer; configured idle timeout remains for a daemon that never had one. The current tier drains; the next is not selected.
- **Tests:** six new real-daemon cases exercise SessionEnd, grace, stored results, SIGKILL, reused identity and no-session idle expiry. Timer tests cover registration/departure between counts and departure from an older daemon. The full suite covers both plugins' per-copy no-daemon-left e2e teardown assertions. S1 is the missing branch assertion.
- **Style:** typed additive seams, bounded ancestor traversal, small dedicated process/expiry modules, no new runtime dependency. Both bundles rebuild without drift. Board/status were not repaired.

## Inputs for the next wave

No blocking fix wave is needed. S1 is one cleanup row with the ownership and acceptance assertions above.

Keep these contracts when changing lifecycle for 001-125 or adjacent scheduler work:

- Register consumer and process identity together. Resume overwrites the old identity. `kill(pid, 0)` is not identity proof.
- Heartbeat calls `dropGoneHarnesses(store, worktreeId, now, { locksDir })`. Foreign/unreadable namespaces are not proof of death. Re-check identity inside the removing transaction.
- Every removal path must forget its harness slot and stamp `departed:<worktree>` (S1). Idle-only exit is for a daemon with no observed consumer or departure since it started.
- Preserve 250 ms presence polling, 3 s departure grace, 5 s default heartbeat and the hook's 2 s budget. Ancestor traversal stays bounded to four hops; no spawned `ps`.
- Shutdown order: stop timers, close watcher/scheduler after the current tier stores stable results, close runner, remove scratch, clear daemon record, close store, close/unlink socket, release singleton lock. A session starting after shutdown committed gets a fresh daemon at a later boundary; do not revive a closed scheduler.
- Teardown retains per-plugin-copy PID scope and cleanup of every registered session/worktree. Do not replace it with a host-wide process-name kill.
- Remaining proof: attended interactive SIGKILL after visible registration, for each harness; controller-owned Cezar destruction if controller integration itself needs evidence. These are verification gaps, not blockers or requests to change product behavior.
