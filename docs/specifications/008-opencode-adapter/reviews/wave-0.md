# 008 wave 0 review

Verdict: **FAIL eae020fc**. **4 proven blockers**, 2 should-fix notes (1 plausible, 1 proven), 1 proven nit. Range: `c12dc371~1..eae020fc`, rows 008-10 and 008-11, landed as 0.1.176. Reviewed 2026-10-14 against D1, D2, D4, D6, D8 and the wave-0 amendments.

## Verification output

The worker started at `5fb1f782`, four documentation-only commits after the candidate. This is a **proven checkout mismatch**, not a product finding: `git diff --stat eae020fc..5fb1f782` names only board/spec/status/brief documents. I detached at the exact candidate for installation, all checks and probes; the tree stayed clean. I then restored the worker branch to commit this report alone. The later brief and latency amendment inform the next-wave inputs below; product evidence is from the named candidate.

```text
$ git rev-parse HEAD
eae020fc6f43b6d0f97738723b7de956c0cfe396

$ npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.176 lint
> biome check .
Checked 1157 files in 571ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.176 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.176 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.176 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0

$ git status --short
(no output)
$ git diff --exit-code
(no output, exit 0)

$ npx vitest run
RUN v5.0.3
Test Files  549 passed | 1 skipped (550)
     Tests  4615 passed | 10 skipped (4625)
  Start at  21:47:30
  Duration  206.20s (tests 96%, import 3%, transform 2%)
exit 0
```

`npm ci` also reported its deprecated `node-domexception` warning, 32 packages seeking funding, and six install scripts outside `allowScripts` (including `opencode-ai`); installation still exited 0. Vitest printed fixture gitdir-repair lines, a cleanup of one process an earlier test run left, and the experimental type-testing notice. There were no failed checks. This is the reviewer's required independent Vitest run, rather than a Squeal checkpoint. OpenCode was available at the checked version; its real `run`/`serve` tests use `runOpenCode`. No real OpenCode was launched directly by a probe.

Calm-load bridge latency is **unverified** in this review: a host sample during verification was load `49.97 25.95 27.73`, above the test's threshold of 4. The existing measurements and the accepted budget repair belong to open question 3 and 008-12; this run does not prove the 80 ms budget.

The throwaway probes invoked `squealPlugin` and `callBridge` through public interfaces at the candidate, with bounded stand-in clients/bridge scripts, and removed their fixtures and killed their deliberately orphaned child. Their decisive output is preserved with each finding below. They changed no tracked file. The passing full suite does not negate those proven failures.

## Blockers

### B1. Proven: the session lookup and bridge have separate full hook budgets

`src/harness/opencode/plugin.ts:150`, `:163`, `:176`, `:223`.

D4 gives `chat.message` **2 s**, and goal 6 says no hook holds OpenCode longer than its deadline. `consumerOf` first awaits one or more lookups, each with a fresh 2 s budget, then `registerOnce` starts another 2 s bridge budget. These are sequential, with no outer deadline.

A probe called the public plugin hook for an unseen session with `session.get` returning a never-resolving promise, followed by a bridge that never exits. The hook returned after **4,015 ms**. A successful bridge delayed by 500 ms after that same lookup miss returned after **2,703 ms**. The existing stalled-bridge test primes `session.created`, so it excludes the lookup from its measurement.

Fix, one worker: use one absolute deadline for the whole hook, pass its remaining time through identity resolution and the bridge, and cancel bridge work when that deadline expires. Do the same for every new D3 hook and for multi-hop identity lookups. Test an unseen/resumed session with a stalled lookup and bridge together; verify silence by 2 s plus a small scheduling tolerance and no late bridge side effect.

### B2. Proven: a bridge descendant survives when the leader exits before the deadline

`src/harness/opencode/bridge-client.ts:48`, `:74`.

D4 says: “A missed deadline kills the process group and is silence.” `exit` sets `exited = true`, and `killGroup` refuses to signal the group once that flag is set. `close` may still be pending because a descendant inherited the leader's stdout.

A probe bridge spawned a Node child with an interval, passed its stdout to that child, and exited 0. At the 1 s deadline `callBridge` returned `null` after **1,008 ms**, but the child was still alive (`/proc/<pid>/stat` state **S**). The probe then explicitly killed the group. The existing group-kill tests leave the leader alive throughout the timeout, so they do not cover this case. This proves the cleanup contract break with a failing bridge stand-in; the shipped registration handler was not observed producing this descendant shape.

Fix, one worker: preserve ownership of the spawned group until inherited pipes close or cleanup finishes; terminate remaining group members on a miss even after leader exit, while handling the pid-reuse concern explicitly. Add a leader-exits-first regression under Node and Bun and assert both silence and disappearance of the descendant. Keep a detached daemon outside the bridge group, as D8 requires.

### B3. Proven: a failed registration with a null header is cached as registered

`src/harness/opencode/plugin.ts:178`, `:179`, `:225`; the other side of the seam is `src/harness/opencode/bridge.ts:60`, `:74`.

D3 requires registration when the instance has not registered the consumer. The accepted wave-0 amendment says a failed or missed registration leaves the consumer unregistered so the next message retries. The bridge explicitly returns `{header: null}` when it cannot open a store, even after ensuring a daemon. The plugin caches every non-null *answer*, before examining `answer.header`.

The cold-store scenario is therefore: config exists, store does not yet exist; the bridge ensures the daemon but cannot register; the plugin marks the consumer registered; after the store appears, later prompts skip registration forever in this instance. The existing bridge test “is silent with a config and no store, and ensures the daemon” exercises that answer. A plugin probe returning `{answer:{header:null}}` for two consecutive prompts recorded **one register request**, and `dispose` sent an end request for the supposedly registered consumer.

Fix, one worker: report explicit registration success in the protocol, or only cache a registration whose non-null header proves it succeeded. Keep a null-header consumer eligible for retry. Add a seam test with a missing store on the first message and a usable store on the second; assert a real consumer row and a registration header after recovery.

### B4. Proven: an unavailable parent lookup registers a resumed child as a root

`src/harness/opencode/plugin.ts:154`, `:165`, `:168`.

D2 requires a child consumer `(rootSessionID, childSessionID)` and a root consumer `(sessionID, main)`. `parentOf` uses the same `null` for an observed root and a lookup error or timeout. `consumerOf` treats the error as evidence that the queried session is a root.

A probe resumed a child before any `session.created`, made its first `session.get` return an error, then recovered the client with the child's actual parent. The bridge requests were:

```json
{"kind":"register","consumer":{"sessionId":"child"}}
{"kind":"register","consumer":{"sessionId":"root","agentId":"child"}}
```

The first prompt was registered as `(child, main)`. After recovery, `shell.env` correctly named `(root, child)` and the next prompt registered that second consumer, leaving the wrong first consumer registered until deletion/disposal or process death. The existing resume test only exercises successful lookups.

Fix, one worker: distinguish unknown/error from a confirmed root; on lookup failure add nothing, register nothing, and leave shell identity unset rather than guessing. Retry on a later boundary. Treat ancestry cycles or depth exhaustion as unresolved too. Test error/timeout then recovery for a resumed child, with no wrong consumer row or registration delta consumed during the failed lookup.

## Should-fix

### S1. Plausible: disposal can miss an in-flight registration

`src/harness/opencode/plugin.ts:178`, `:228`, `:258`.

`dispose` snapshots only completed registrations. If it runs while a registration bridge is writing the consumer, it can return with no consumers to end. The bridge then returns, sees `disposed`, and skips adding the consumer to the local map, so it is never unregistered by this instance. OpenCode process liveness eventually removes it; a live disposed instance could leave it active until then. The local interleaving is visible in code, but a real OpenCode disposal overlapping this hook was not established.

Next wave: track/cancel and settle in-flight registrations within the 3 s disposal budget, or unregister any registration that succeeds after disposal. Add a delayed-register/dispose overlap test without relying on process exit.

### S2. Proven: the added part id is generated independently of the message's last part

`src/harness/opencode/plugin.ts:62`, `:182`.

D3 says the part id must sort after the message's last part, and is derived from that part or nothing is added. `partId()` uses the current clock and never inspects `output.parts`. A probe compared a valid last-part id generated at `Date.now() + 60_000` with the newly generated current id: `sortsAfter` was **false**. This proves the algorithm does not enforce the amended ordering rule. A clock correction or future-dated last part causing it in real OpenCode remains plausible; no lost prompt or missing model text was observed.

Next wave: derive an accepted `prt` id that sorts after the existing parts, with the explicit no-add fallback. Test against a last part later than the current clock and assert the registration report follows the original prompt in a real fixture request.

## Nits

### N1. Proven: `shell.env` still changes output after disposal

`src/harness/opencode/plugin.ts:240`.

The adapter's comment and disposal test promise that every hook is silent after disposal, but `shell.env` has no `disposed` guard. It still prepends `bin` and can query a session and set identity after `dispose`. This is a local lifecycle inconsistency, with no demonstrated user failure. Add the guard and extend the existing disposal test to invoke `shell.env` too.

## What fits

- The Bun plugin and Node bridge are cleanly separated. The plugin's source graph contains only OpenCode adapter modules; its only external imports are `node:child_process`, `node:fs`, and `node:path`. `node:sqlite` and `process.execPath` stay out of the plugin bundle; using `process.execPath` inside the Node bridge is correct.
- The bridge uses the shared registration, delivery, ensure and session-end code without modifying its public contracts. `bridgeDeps` records the supplied OpenCode pid, and daemon startup uses the existing detached daemon path, preserving D8.
- The fast path covers plain repositories, a root config, existing common-dir stores, relative gitdir/commondir in linked worktrees, and outside-repository silence. Registration sends `input.worktree`, while bridge execution uses `input.directory`; it never uses `project.worktree`.
- Successful session-created and resume lookups map roots and children to the D2 consumer, and `shell.env` agrees. Normal deletion ends a root's consumers together and a child's consumer alone. Concurrent first messages share a registration, and a failed bridge process remains eligible for retry.
- `runOpenCode` protects HOME, TMPDIR, all four XDG directories, model-fetch/update switches and the config/home/database redirection variables. It starts the binary with an explicit environment rather than inheriting the host's environment. Projects are fresh git repositories outside this checkout through `piBase`. Config directories are seeded with the pinned plugin package, and the scripted provider uses the bundled OpenAI-compatible implementation. The preserved isolation experiment runs as `squeal-e2e`.
- The latency test actually invokes the built bridge 30 times for each of ping, registration and end, records p50/p95/max, and asserts only outside CI below its load threshold. Its registered case intentionally includes shared store work and daemon liveness, using a live socket and quiet CLI; it is not a bare-Node-only measurement. Open question 3's budget gap is already assigned to 008-12, so it is not a new blocker.
- The OpenCode manifest, committed dist, executable launchers, build step, CI drift path and version-bump guard are present. The launcher matches Pi's format 3. Stable `current` installation and user text/status are deferred to their named wave-1 rows.

## Inputs for the next wave

- 008-12 owns all blocker repairs (`plugin.ts`, `bridge-client.ts`, protocol/bridge if success needs a new field) and their adapter tests. Resolve B1 to B4 before relying on this scaffold for deliveries and idle wake. Keep all shared Claude Code, Codex and Pi fixture contracts unchanged.
- Carry one whole-hook budget through lookup and bridge calls: 2 s for prompt/tool hooks, `stop.waitMs + 500 ms` for idle, 3 s for disposal. A timeout must cancel remaining work and leave no registration or delivery credited later.
- Preserve D2's mapping across every new bridge operation: root `{sessionId: root}`, child `{sessionId: root, agentId: child}`, with `worktree: input.worktree` and `pid: process.pid`. Do not turn a failed lookup into a root consumer.
- Root deletion calls `end` with `sessions: [root]`; child deletion/disposal uses `consumers`. A confirmed registration is the prerequisite for caching and subsequent delivery; unavailable storage must remain retryable.
- Use `runOpenCode` for all agent-user OpenCode tests. E2E installation outside the helper runs as `squeal-e2e` with the same confinement and seeded config. Preserve the checked 1.18.35 versions until isolation is re-checked.
- 008-12 still supplies tool delivery/deny, primer, prompt deltas, continuation/abort handling, child idle cleanup, idle wait cancellation, and the per-hook Codex latency comparison. 008-13 supplies shell pull credit and status; 008-14 supplies stable-link install/update/uninstall. Their absence in this wave is expected.
