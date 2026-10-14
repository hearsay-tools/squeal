# 009 waves 2 and 3 review

Row: 009-22. Candidate: `cf1e952c..3fd4916de395c089e67f6380bf58db9029ac0584`.
Scope: 009-15, 009-16, 009-18 and 009-19 against spec 009 D1, D4, D5, D6, D7 and Testing, the amendments in `status.md`, and spec 005 D3. `wave-0.md`, `wave-1.md` and `wave-1.5.md` were read first. B1's fix `02249f23` remains settled. Interleaved spec 007 work and release-eval results are outside this row's prosecution.

## Verification output

The dispatched HEAD is `606d5827eb7328cbbd750d71b739e4b56a2dc4bc`, not the candidate. **Proven provenance mismatch, resolved for verification:** every build, independent test and probe below ran in the explicitly authorized detached worktree `/tmp/review-009-w3` at `3fd4916d`. The report alone is committed on the dispatched branch. No tracked product code was changed.

```text
$ git worktree add --detach /tmp/review-009-w3 3fd4916d
HEAD is now at 3fd4916d
$ git rev-parse HEAD
3fd4916de395c089e67f6380bf58db9029ac0584
$ npm ci
added 174 packages, and audited 175 packages in 5s
found 0 vulnerabilities
$ npm run lint
> biome check .
Checked 1133 files in 466ms. No fixes applied.
$ npm run typecheck
> tsc --noEmit
(exit 0)
$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts
(exit 0)
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist
(no output; exit 0)
$ git status --short
(no output)
```

The install also reports four dependency install scripts not covered by `allowScripts`. This review uses direct Vitest for the repository's independent reviewer gate, not Squeal's checkpoint. The full suite completed on Node 24.21.0 with two workers.

```text
$ npx vitest run --maxWorkers=2
FAIL test/evals/atomic-trend.test.ts:270
  AssertionError: expected [ { measure: 'own-run-covers', …(3) } ] to deeply equal []
  before 11/20; now 0/10; p = 0.0030746531496156694
Test Files 1 failed | 536 passed | 1 skipped (538)
Tests 1 failed | 4525 passed | 10 skipped (4536)
Duration 1281.51s
(exit 1)
```

**Proven unrelated red gate:** the sole failure is the release-eval flag already recorded on the board and in the wave-2 amendment, present since `bdd05f15` and owned by the 0.1.168 releasing coordinator. `test/evals/atomic-trend.test.ts` is unchanged across this range. This is not a scoped Pi blocker, and it is not a green full-suite result. All other test files that ran passed, including the existing Claude Code/Codex suites and the Pi e2e. The suite also printed two fixture gitdir-repair notices, an earlier-run process cleanup notice and Vitest experimental type-test notices; none produced another failure.

The focused Node 22 run independently covers the changed worker/host, mode and cancellation behavior, fixture isolation, installer/update, and the installed-package e2e:

```text
$ /home/agent/.nvm/versions/node/v22.23.3/bin/node node_modules/vitest/vitest.mjs run test/harness/pi test/harness/pi-fixture.test.ts test/integration/pi-wake.test.ts test/e2e/pi.test.ts test/cli/install-sh-pi-update.test.ts test/cli/update-pi.test.ts --maxWorkers=1
Test Files 16 passed (16)
Tests 137 passed (137)
Duration 90.15s
(exit 0)
$ npx tsc --ignoreConfig --noEmit --strict --module nodenext --skipLibCheck --types node test/fixtures/pi/fake-provider.ts
(no output; exit 0)
```

The standalone check matters because the fake provider is excluded from the repository's TypeScript and Biome inputs. Node 22 printed dependency proxy-agent warnings and SQLite warnings from the test process; no Pi extension error was reported.

Three throwaway probes ran from an ignored directory with a separate Vitest config. All real Pi invocations used `test/helpers/pi.ts`; installer/update runs used `machine()` with isolated HOME and stub harnesses. No real user settings, credentials, `~/.pi`, or public release download were used.

```text
$ npx vitest run --config node_modules/.review009w3/config.mjs --maxWorkers=1 --reporter=verbose
(each probe selected separately)
loaded installed extension across two updates:
  second update removes loaded directory: true
  old primer CLI fails: MODULE_NOT_FOUND; Pi exits normally
  Test Files 1 passed; Tests 1 passed; Duration 2.13s
same-format launcher:
  update succeeded; installed launcher format 2 unchanged; retains install.sh for Pi
  Test Files 1 passed | 1 skipped; Tests 1 passed | 1 skipped; Duration 1.98s
latest pre-wave-3 installer:
  exit 1; pre--pi script exited 2; Pi 0.1.172 not updated; no harness commands
  Test Files 1 passed | 2 skipped; Tests 1 passed | 2 skipped; Duration 2.30s
(all exit 0)
```

The candidate remained clean after all checks. Scratch probes and the detached worktree were removed after verification:

```text
$ git status --short
(no output)
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist
(no output; exit 0)
$ git worktree remove /tmp/review-009-w3
(no output; exit 0)
```

A post-report `npm run lint` in the dispatched checkout could not execute (`sh: 1: biome: not found`; no installed dependencies there). Candidate lint above passed. The report-only change is checked with `git diff --cached --check`; no candidate validation is attributed to the dispatched checkout.

**Unverified limits:** no interactive TUI or real-model dogfooding, public latest-release network check, or real `/reload` across an installer update. The TUI mode is covered by recorded events; RPC wake and the installed package run against real Pi with its scripted provider. Those distinctions remain part of 009-20's proof.

## Verdict

PASS `3fd4916d`: 0 blockers, 2 nonblocking should-fix notes (1 plausible timing risk and 1 proven limit of the accepted retention policy), and 1 proven nit. The independent full suite is red only on the previously documented release-eval flag. No proven break of this row's goals was found.

## Blockers

None established by the scoped review.

## Should-fix

### S1. Replace the deny e2e's elapsed-time window with a request barrier (plausible)

`test/e2e/pi.test.ts:36`, `:151` and `:169` give request 1 a fixed 15,000 ms delay, then require the daemon's regression to land during that delay. The test also expects request 1 to contain no regression, so it assumes the result did not land before the preceding tool boundary. Neither boundary is synchronized with the result. A sufficiently slow re-run misses the write; a sufficiently fast re-run or delayed Pi boundary delivers the regression before the intended deny scenario.

The fixture exposes its elapsed-time assumption rather than silently claiming a deny: it checks `landed < RERUN_WINDOW_MS` and inspects the actual error tool result. Both reviewed runs of the shipped test pass. **No load-induced flake was reproduced**, so this is a nonblocking test-reliability note, not a proven product failure.

One fixture worker can add an optional per-request release file to the fake provider. Hold the relevant model response until the test has observed the regression, and hold the re-run until that request starts, with explicit bounded waits and cleanup on abort. Keep the installed shipped daemon and the existing error-result/re-issue assertions. Increasing 15 s alone preserves the race and makes every successful test slower.

### S2. State the one-update retention limit for sessions with no old daemon (proven, nonblocking)

`install.sh:218` retains the newest previous directory. `:253` additionally retains directories whose path occurs in `ps -A -o args=`. Pi loaded through user settings names Pi's CLI in its process arguments, not the installed extension. A daemon can supply the old package path, but a session in a repository with no Squeal config has no daemon. An old daemon can also cease to be the active version; daemon takeover across two releases was not exercised here.

The real-Pi probe installs the candidate's actual `plugins/pi` with `runPi({ install: [old] })` into an isolated agent directory. It pauses a running RPC turn at `gateCall(0)` in a project with no Squeal config. Beside that turn, the stub-machine installer installs releases 0.1.174 and 0.1.175 in succession. After the first, the old 0.1.173 CLI exists. After the second, the whole old directory is gone. The same still-running Pi process executes the old absolute CLI path and receives `MODULE_NOT_FOUND`; Pi itself exits normally. The new releases are local fixture archives, not published releases.

This is **not a blocker**: the human's scope explicitly permits keeping one version back, and the wave-3 amendment accepts that policy. The `ps` check proves retention for a process that names a directory, not every process that has loaded it. The unqualified message at `install.sh:227`, “Pi sessions already open keep the Squeal they loaded,” hides that limit.

Small follow-up: state that an open session must `/reload` before another update if its old package has no running daemon, and add this two-update real-session regression. If the coordinator instead wants arbitrary loaded-session retention, that needs a separately scoped process-to-package record; do not treat a `ps` argument scan as that record.

## Nits

### N1. Raise the launcher format when changing its installed update wording (proven)

`plugins/pi/bin/squeal-launcher:79` and the other two launcher copies remove “and install.sh for Pi” but keep format 2. The existing recopy rule in `src/cli/update.ts:194` replaces a launcher only for a strictly larger format. `squeal update` invokes `install.sh --pi`, which does not call `copy_launcher`.

The probe installs a format-2 launcher from `cf1e952c`, updates Pi successfully from 0.1.172 to 0.1.173 through the candidate's `main(["update"])`, and verifies the installed launcher is byte-for-byte unchanged. It still has the old Pi instruction. The package and selected CLI update correctly; this is obsolete guidance, not a failed update.

One installer worker can raise the format in all three copies and update the format assertions, with a regression that begins with the preceding release's actual launcher. The existing test of a synthetic format 3 proves the recopy mechanism but does not ship that migration.

## What fits

- **D5 modes and handler bounds (proven):** `extension.ts:131` starts a separate host wait and attaches a continuation without awaiting it. Only `tui` and `rpc` arm it. `input`, `before_agent_start` and shutdown cancel the pending host answer; the identity check suppresses an obsolete answer. Shutdown posts cancellation before unregistering. The host's wait has no referenced deadline timer and does not replace a healthy worker; a normal bounded request still can. Recorded-mode tests, real RPC tests, bundle exit tests and the native SQLite deadline/exit test pass on Node 22.
- **The shared waiter seam (proven):** `waitIdle`'s optional fifth argument reaches `delivery.waitForDelta` and registration sleeps. Cancellation frees the waiter lock and leaves a later result for a prompt. Existing callers omit it; `formatDelta(outcome, undefined)` retains the default command, while Pi supplies the quoted absolute Node/CLI command. The new `"pi"` Stop harness does not consume another harness's waiting-entry record; Pi still answers for its own slow tier.
- **D1 ownership and updates (proven within tested cases):** removal iterates only `owned_pi`; retained directories stay recorded so a later cleanup or uninstall owns them. The current directory is excluded, the newest previous directory stays, and a process naming a still-older directory prevents its deletion until that process exits. Pi-only update does not call Claude Code or Codex; the all-three test converges versions. The pre-`--pi` release script refuses the option before mutation, and `updateCommand` reports not updated and exits 1. The single-release retention proof and the broader S2 limit are distinct.
- **Fixture isolation and wave-0 repairs (proven within checked paths):** caller overrides of all six isolation variables are rejected before spawning Pi. HOME, TMPDIR, agent state, plan and log are fixed afterward. `piBase` avoids a repository-owned TMPDIR; context/skill/trust flags protect repository cwds. The real fixture tests exercise that case. The fake provider now typechecks against Pi 1.0.4 without unexplained `any`; the native-blocked exit regression pins wave-0 S2's accepted busy-timeout limit.
- **Installed-package proof (proven):** the e2e copies tracked Pi package files, installs through real `pi install`, loads from Pi settings, and sees the copied package's daemon. It checks baseline, next-request failure and recovery, deny then re-issue, an RPC wake once, quiet repositories, and the primer's absolute CLI. The deny's timing evidence has the S1 limit. B1's reviewed continuation boundary was not reopened by these changes.

## Inputs for the next wave

1. No repair wave is required by this review. Preserve `input` as waiter cancellation only, with run flags reset at `before_agent_start`.
2. Keep `DeliveryHost.wait` separate from bounded calls. Cancellation must release the waiter lock before shutdown unregisters; only a live current wait may call `sendMessage` with `triggerTurn: true` and `deliverAs: "followUp"`.
3. Fold S1 and N1 into fixture/installer maintenance. Keep S2's accepted single-update guarantee explicit in user text and in 009-20's open-session update proof. Decide separately if retention must cover two updates without reload.
4. Dogfooding still owns real TUI/model attribution and `/reload` behavior. Publish a release whose installer supports `--pi` before claiming the public latest-release route successfully updates Pi; the transition currently fails honestly.
5. Full-suite release-eval failures remain with their owning coordinator. This review's scoped verdict does not claim that an accepted unrelated red gate is green.
