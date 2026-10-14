# 009 wave 0 review

Candidate: `a19b6638..8d4011447dc9148f1ebebc71fcc9c251afe316eb`. Row: 009-14.
Reviewed against `spec.md` D1, D2, D4, D6 and D3's session events, with the 2026-10-14 amendments in `status.md` and the wave-0 done-when clauses. The other events, install and status are wave 1, not missing wave-0 work.

## Verdict

PASS `8d401144`: 0 blockers, 2 plausible should-fix notes, 1 proven style nit. The full-suite check is red on unchanged tests under heavy host load; it is not evidence of a proven wave-0 break. The focused Pi run passes all 50 tests. No claim that the repository as a whole is green.

## Verification output

The dispatched checkout was `6a069fbc5c41e4f8bd5e6fd9be3eba5cfe471392`, not the candidate. **Proven provenance mismatch, resolved for verification:** `git diff --stat 8d401144..HEAD` lists only board, spec, status and the wave-1 brief. The parent explicitly authorized a temporary detached worktree at the candidate, including build. All evidence below comes from that clean candidate worktree, `/tmp/review-009-w0`, on Node 24.21.0. The report is committed on the dispatched branch; no product code changes.

```text
$ git rev-parse HEAD
8d4011447dc9148f1ebebc71fcc9c251afe316eb
$ npm ci
added 174 packages, and audited 175 packages in 22s
found 0 vulnerabilities
$ npm run lint
> biome check .
Checked 1119 files in 1585ms. No fixes applied.
$ npm run typecheck
> tsc --noEmit
$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist
(no output; exit 0)
$ git status --short
(no output)
```

The install warns that four dependency install scripts are not covered by `allowScripts`; it reports zero vulnerabilities. This review runs Vitest independently, as the reviewer gate requires, rather than substituting Squeal's checkpoint. The full suite completed with exit 1. A targeted run then discriminated the changed Pi behavior without repeating the full proof:

```text
$ npx vitest run
Test Files  8 failed | 516 passed | 1 skipped (525)
     Tests  4 failed | 4391 passed | 14 skipped (4409)
  Duration  336.84s
$ npx vitest run test/harness/pi test/harness/pi-fixture.test.ts --maxWorkers=2 --reporter=verbose
Test Files  8 passed (8)
     Tests  50 passed (50)
  Duration  7.60s
```

**Unverified full-suite gate:** all failing files are outside the range. The failures were:

| File | Output |
| --- | --- |
| `test/integration/optimizer-off.test.ts` | afterAll hook timed out in 10000 ms |
| `test/policy/repository-inputs.test.ts` | beforeAll timed out in 60000 ms; afterAll in 10000 ms |
| `test/runners/node-test/enumerate.test.ts` | afterAll timed out in 10000 ms |
| `test/runners/pytest/adapter-admission.test.ts` | Python 3.13 afterAll timed out in 10000 ms |
| `test/runners/pytest/adapter.test.ts` | Python 3.13 afterAll timed out in 10000 ms |
| `test/runners/pytest/fixtures.test.ts` | `expected 20718.078853999992 to be less than 5000`; afterAll timed out in 10000 ms |
| `test/watcher/linked-exclusions.test.ts` | afterEach timed out in 10000 ms |
| `test/watcher/parcel-root.test.ts` | two tests timed out in 5000 ms; afterEach timed out in 10000 ms |

Observed host load reached 126 on 24 CPUs during the full run. Load is a plausible explanation, not a controlled demonstration of the cause. Squeal independently reported watcher and repository-input hook timeouts, both later recovered under the same inputs; those background results do not replace the independent run.

The focused run includes all three real-Pi fixture modes, session identity and reload, both shutdown deadlines, worker replacement, bundle exit and package/version checks. It printed these round-trip measurements (50 calls, 10 fresh workers), at load `29.33 63.79 50.06`. Above the test's load threshold of 4, its latency assertion is deliberately disabled; this is a measurement, not an independently verified calm-load bound:

| Call | p50 ms | p95 ms | max ms |
| --- | ---: | ---: | ---: |
| ping | 0.1 | 0.1 | 0.2 |
| boundary, delivers | 4.8 | 5.9 | 9.1 |
| boundary, silent | 3.3 | 3.5 | 3.6 |
| boundary, fresh worker | 64.9 | 78.5 | 78.5 |

The candidate remained clean after both runs; the three-plugin drift command still exited 0.

**Unverified limits:** no independent Node 22 CI run or repeat of the throwaway-user syscall isolation experiment. The existing isolation report was read, and the actual Pi fixture in the independent suite is launched only through `test/helpers/pi.ts`. No direct Pi invocation or access to the user's `~/.pi`.

## Blockers

None found.

## Should-fix

### S1. Keep the fixture's isolation variables outside caller overrides (plausible)

`test/helpers/pi.ts:105-114` sets the isolated `HOME`, `TMPDIR`, `PI_CODING_AGENT_DIR`, `PI_OFFLINE`, plan and log paths, then spreads `options.env` over them. The current fixture calls do not override them, so this is not evidence of a leak in wave 0. A later daemon/environment test can accidentally replace one of these fields and undo the isolation that the Testing section requires. The helper's public contract says the run gets an isolated environment; protect that contract before adding more callers.

Small fix for the fixture owner: reject overrides of the protected isolation and fixture-path keys, or apply them after the caller's environment. Keep ordinary daemon configuration overrides available. Verify that an attempted protected override is rejected or retains the temp-directory path without launching Pi against a real home.

### S2. Native worker stalls need a separate process-exit check (plausible)

`src/harness/pi/host.ts:53` calls `dead.terminate()` after timeout or stop. Node 24.21.0's `Worker.prototype.terminate()` starts with `this.ref()`. More importantly, worker termination does not interrupt every synchronous native call. D4 promises “Nothing the extension holds keeps the process alive after `session_shutdown`”; the existing host/bundle tests stall JavaScript handlers, not native store calls.

A throwaway probe against the candidate imported `createDeliveryHost` in a plain-Node child. The parent held `BEGIN EXCLUSIVE` on a temporary SQLite database. The injected worker opened that database, set `PRAGMA busy_timeout=5000`, and executed `BEGIN EXCLUSIVE` when the host posted a request. The child awaited `host.call({kind: "ping"}, 3000)`, called `host.stop()`, printed the return time and had no other work. Output:

```text
candidate: result null; returnedMs 3005; process exitedMs 5154; exit 0
```

The deadline bounds the handler, but the native-blocked worker delays process exit by about two seconds after it. A comparison that explicitly unrefed the worker after termination also waited for the native call; adding `unref()` alone is not an established repair. These mechanism and probe results are proven, but **the shipped Pi failure remains plausible**: the injected SQLite timeout was 5000 ms, while shared `withContext` defaults to 1000 ms, and this review did not reproduce a shipped worker exceeding shutdown's 3000 ms. No blocker is inferred from the broader injected scenario.

Small follow-up: add a native-blocked-worker exit test, retaining both handler-return and child-exit timings. Document or constrain the native-call budget separately from the handler deadline. If D4 is meant to cover arbitrarily stalled native initialization or filesystem calls, the coordinator must settle whether to amend that guarantee or use a host that can be killed independently. Do not call the current JavaScript-stall proof a native-termination proof.

## Nits

### N1. Explain the fake provider's untyped boundary (proven)

`test/fixtures/pi/fake-provider.ts:42`, `:52` and `:100` use `any` without an explanation. The styleguide says “No `any` without a comment saying why.” The fixture is excluded from Biome, so the lint result does not settle this rule. Pi 1.0.4's real package is now a pinned devDependency.

Small fix: use its provider/message types where possible, and explain any remaining cast at the scripted-provider boundary. No runtime change required.

## What fits

- **D4 host and liveness:** `host.ts` attaches `message`, `error`, `exit` and `messageerror` listeners before `unref()`. Each pending call holds only a bounded timer; settling clears it. Timeout discards the worker and resolves all its pending requests to silence. A dead or uncaught-throwing worker is discarded, and the next call creates one. `stop()` silences pending requests and prevents later calls. The factory creates no worker until a session event. The deadline and normal process-exit proofs pass; the broader native-stall guarantee has the S2 limit.
- **D2 identity and registration:** `sessionOf` reads each event's context, tolerates stale contexts, and passes the id into the shared `main` consumer. The worker records the process it runs within, using `process.pid`, as Pi's harness process. Duplicate starts within the instance are suppressed before the worker call; the accepted timeout amendment defers registration recovery to the next tool boundary.
- **Reload and shutdown:** reload deliberately stops the outgoing host without unregistering. A registered consumer keeps its view and receives no new header. Startup/resume sweep other session consumers; new/fork leave them alone. Quit/new/resume/fork unregister the outgoing session, and every later event on the shut-down instance is silent. `session.test.ts` checks preservation of an undelivered failure across reload.
- **D3 session header:** registration is a displayed `squeal` custom message with `deliverAs: "nextTurn"`, with no extra model request. This matches Pi 1.0.4's `sendCustomMessage` next-turn queue. The primer is deliberately deferred to wave 1's system-prompt section.
- **D1/D6 package:** the manifest explicitly lists the ESM extension and skills, declares Pi as a peer, and has no runtime dependency. The extension imports only Node built-ins and finds its worker by a sibling URL. The shared builder copies the CLI/front desk, node:test, observation and pytest runtime files. Root and plugin versions are 0.1.170; the version guard includes Pi. The build reproduced all three committed plugin dist trees without drift. No shared harness implementation or recorded JSON fixture changed; the Codex test's build-command expectation simply adds Pi.
- **Testing isolation:** the helper constructs an environment rather than inheriting credentials, moves HOME/TMPDIR/agent state into the run's directory, and places the project outside the repository. The prior experiment explains why all three locations must move. Pi is pinned to the checked 1.0.4, and the fixture asserts a write result in the next provider request in print, JSON and RPC modes.

## Inputs for wave 1

1. Keep D4's shared-code calls off Pi's main thread. Reuse `DeliveryHost.call`: 2,000 ms for ordinary events, `stop.waitMs + 500` for settle, 3,000 ms for shutdown. A handler receives `null` on failure/deadline and must emit no message, block or continuation in that case.
2. The existing `boundary` request accepts `{ sessionId, cwd }` and uses shared `deliver`, including first-boundary registration when startup had no usable store. Wire it only after an assistant turn with tool calls, once per parallel batch; the final text-only turn must leave news to settle.
3. Preserve the per-instance shutdown guard and reload's retained delivery view. A later handler reads its current context rather than capturing an old session. Duplicate RPC starts must not reseed delivery.
4. Registration currently sends the header only. Add the fixed primer under `systemPromptOptions.sections.squeal`, using `piCommand`'s absolute Node and CLI paths. Type the API against the real pinned package as 009-12 already requires.
5. The worker protocol still needs start/end-turn, regression peek/deny and Stop operations for D3; idle wake must cancel on input/shutdown and run only in TUI/RPC. Demonstrate next-request delivery and the continuation guard with the isolated real-Pi fixture, including replacement and abort events.
6. Fold S1 and N1 into fixture maintenance; preserve the native process-exit question in S2 when extending the host. Install/update/uninstall, status without extension registration, and the release-package decision remain 009-13's work. This scaffold review does not establish the final spec's real-model or TUI goals.
