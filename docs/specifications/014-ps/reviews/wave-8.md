# Wave 8 review

FAIL ec15d10bf2b103e10e49a5f18d79d98cb4defbaa

Row 014-46. Candidate `cand/0.1.267`, range `81b927e08..ec15d10bf`, 20 commits. **1 blocker, 1 should-fix, 0 nits.** The blocker is in the new test temp-parent sweep. The `ps` changes meet their amended contracts.

## Verification

Checked on Node v24.21.0. `git rev-parse HEAD` returned the pinned candidate. The tree was clean throughout the checks and remained clean after the independent suite. Only this findings file was then added.

`npm ci` was completed by Cezar before the session in 10 s, as the task's setup receipt states. It was not repeated, per the brief. Its detailed output was not available for independent inspection. No `npm run build` ran. The committed bundles were inspected and executed directly.

```text
$ npm run lint
> squeal@0.1.267 lint
> biome check .
Checked 1756 files in 813ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.267 typecheck
> tsc --noEmit
exit 0

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/f7050dd3-d840-424e-bae7-0ff7602adee1

 Test Files  901 passed | 2 skipped (903)
      Tests  7711 passed | 11 skipped (7722)
   Start at  18:58:57
   Duration  1257.69s (tests 97%, import 2%)

    Isolate  903 workers spawned · ~149ms startup each (spawn + environment, per file)
exit 0
```

One independent full suite ran, under the shared lock. The start time above is local time (UTC+02:00). The output also contained two fixture `gitdir incorrect` repair notices, one nested setup's earlier-run stray cleanup notice, and Vitest's experimental type-testing notices. It reported no test failure. This includes `test/global-teardown.test.ts`, the store, slow, delivery, setup, update and `ps` tests, `test/keys/key-format.test.ts`, and `test/harness/ps-bundle.test.ts`. `git diff --check 81b927e08..ec15d10bf` also passed.

Direct checks of all four committed `plugins/*/dist/cli/ps.mjs` bundles returned:

```text
ps --leftovers: exit 2
squeal ps: unknown option "--leftovers"
usage: squeal ps [--repo] [--full] [--json]

ps.mjs:     129157 bytes
squeal.mjs: 2513244 bytes
ratio:      0.0513905534 < 0.125
```

The temp sweep probe used only a private `mkdtemp` root. It extracted the candidate's `sweepDeadParents` function, stripped its types, and supplied its actual filesystem operations and `isAlive` helper. It did not call the sweep against real `/tmp`. **No `/tmp/squeal-vitest-*` parent of another run was touched by the reproduction.** Its exited PID came from a child the probe started. Its live PID was the probe's own PID. The probe removed its own root afterwards.

```text
non-run prefix match: preserved=false
live local PID (the branch a reused PID takes): preserved=true
absent local PID, same uid: preserved=false
```

The last case models the local observations for an invisible foreign-namespace PID. It is not a native namespace reproduction. Both namespace attempts were refused (`unshare: ... Operation not permitted`). B1 is established from the source below; native reproduction on this host remains unverified. No `ps` end command was run. The probe sent no signal to a process it did not start.

After the full suite, its `/tmp/squeal-vitest-1450584-*` parent was absent. Other sessions continued to create temp parents and short-lived e2e fixtures during the before/after inventory. That shared inventory cannot prove that every newly seen directory belongs to this gate. The killed-run and inherited-temp behavior itself passed its real fork-worker test.

## Blockers

### B1. A locally invisible PID authorizes deletion of a live run's parent

**Proven by source.** `test/global-teardown.ts:42` selects the shared `/tmp` root. `test/global-teardown.ts:136` takes only a numeric PID from a parent's name. `test/global-teardown.ts:137` treats `isAlive(pid) === false` as sufficient evidence of death. `test/global-teardown.ts:141` then removes the whole directory when its uid matches. The called helper at `test/daemon/strays.ts:130` uses `process.kill(pid, 0)` in the caller's PID namespace and returns false on its failure. The new parent records no namespace identity.

Concrete failure: two containers use separate PID namespaces, the same mapped uid, and a shared `/tmp`. A live run creates `squeal-vitest-12345-abc123` in container A. PID 12345 does not exist in container B. B's next test setup sees A's directory, gets a failed local PID lookup, passes the uid check, and recursively removes A's live test files and sockets. A host run's name can be misread from a container in the same way. An equal uid proves filesystem ownership, not process death across namespaces.

This breaks row 014-36's rule that the next setup removes parents whose Vitest process is gone, and the brief's explicit requirement to remove only dead runs' parents of this user. The existing test at `test/global-teardown.test.ts:98` covers only live and dead PIDs in one namespace. Green tests do not exclude this failure.

**Fix for one worker:** record process identity when making a parent, before workers can create files in it. Include the PID namespace and process start identity, or use a filesystem-held lifetime lock that remains valid across the shared mount. Delete only after that identity proves the owning run dead. Skip a foreign or unreadable identity; a PID absent from the caller's namespace is insufficient. Add a private-root test for the foreign-namespace case. Any native namespace probe must use a private sweep root or a private tmpfs, never the host's shared `/tmp`.

The local PID reuse case is conservative: any live process at the old PID preserves the old run's directory, even when it is an unrelated long-lived process. The debris remains until that PID exits and another setup sweeps it. A recorded start identity can distinguish this case without weakening B1's safety rule.

## Should-fix

### S1. The sweep accepts names that no temp-parent maker emits

**Proven by private-root experiment.** `test/global-teardown.ts:136` uses `/^squeal-vitest-(\d+)-/`, with no suffix validation or end anchor. The maker at `test/global-teardown.ts:70` emits exactly six random letters and digits after the PID. A same-uid directory named `squeal-vitest-<dead-pid>-backup-not-a-run` is nevertheless removed, including its contents. The probe demonstrated this on its own directory. The unrelated-name case at `test/global-teardown.test.ts:102` uses a different prefix, so it misses this boundary.

**Fix:** restrict the name to the complete maker's format, for example `/^squeal-vitest-([1-9]\d*)-[A-Za-z0-9]{6}$/`, and require B1's run identity. Test a malformed suffix, extra trailing text, a symlink and a different owner, as well as the valid dead-run parent. This can go with the B1 repair in the same file ownership.

## Nits

None.

## What fits

- **Drop candidate 1 / 014-45:** `flags-leftovers.ts` is gone. There is no `leftover-temp`, `cwds`, `unixSockets`, or unknown-path reader in `src/core/ps` or `src/cli/ps.ts`. The remaining `activity.paths` in `work.ts` names slow test files. The CLI rejects the removed option before taking a snapshot. `PsUnknown` has only `what` and `why` (`src/core/ps/shape.ts:267`). Keeping JSON `v: 1` is sound: the removed optional field and flag cease to be produced, while surviving field meanings and types remain compatible. A surviving file flag always has a path and byte count (`shape.ts:248`). No repository reader depends on the removed output.
- **014-36, apart from B1/S1:** the default parent is `/tmp/squeal-vitest-<pid>-XXXXXX`, regardless of the inherited `TMPDIR` (`test/global-teardown.ts:42`, `:70`). It sets all three temp variables before workers start and restores them at teardown. The daemon-key case and the `mkdtemp` failure make no parent (`:63`, `:71`), as accepted in the last status amendment. The real killed-run test at `test/global-teardown.test.ts:113` proves inheritance and removal on the next setup. This row did not change the test helpers.
- **014-41:** `harnessGone` still treats a different or unknown namespace and a failed stat read as no proof of death (`src/core/delivery/harness-process.ts:70`, `:85`). The shared alive rule preserves start-time and zombie checks. `readSlowActivity` still maps unknown formats and parse failures to `null` (`src/core/slow/state.ts:35`); `ps` now rejects a waiting value without a valid `for` and a running value without `since` through that same decoder (`:51`). This is D3's unknown-format behavior and the accepted integration decision. Checkpoint lanes still retain only `fast` and `slow`, with the store reader's `{}` fallback (`src/core/store/repos/runs.ts:127`, `:141`). Daemon tokens still require matching start and version; the store reader maps both mismatch and unknown format to its former `undefined` result (`src/core/store/repos/worktrees.ts:46`, `:57`). The immutable URL helper has the same escaped URL and `immutable=1` semantics. Key-format version and pinned key output are unchanged.
- **014-41's accepted limits:** `slotsOf`, `text` and `finiteNumber` remain in `work.ts`, as the last status amendment explicitly accepts. The five selected decoders and liveness predicate are shared with their owning modules. This does not silently broaden the row to other writers.
- **014-42:** `claudeInstalls` is the sole `installed_plugins.json` parser (`src/core/daemon/version.ts:95`). `claudeLoaded` preserves entry order, string-version checks, user scope, and exact project-root matching (`:119`; `src/cli/setup/harnesses.ts:67`). `update.ts:224` still collects every string `installPath` without requiring a scope or version. `codexNewest` filters before comparison and now accepts `x.y.z` only (`version.ts:137`), as accepted. Discovery carries the plugins directory and marketplace from its one cache regex. Setup/update tests pass.
- **014-43:** socket and daemon-lock names now use their makers' readers, pool directories call `slowSlotDir`, and the child variable and USER_HZ come from their owning modules. `discover.ts:182` reads the actual numeric `--await-lock` argument. `flags.ts:145`, `:176` compare age against that wait plus 10 s. A direct source probe through discovery and flags, in a private fixture repository, found no `no-lock` at 200 s or 610 s for `--await-lock 600000`, and found it at 611 s. With no argument, it found none at 40 s and found it at 41 s. No printed command was executed. `WAITER_LOCK`, `sessionDirs` and update's separate Codex cache-path construction are the coordinator's explicit deferrals, not missed acceptance items.
- **014-44, slices 1 to 8:** the unused fields and helper are removed; slice 1's consumer query no longer reads `lastSeenAt`. Drain time is passed as data, without interpreting the state string. Sentence and column durations share `render-units.ts`. Each sample retains one host reading, and the snapshot uses the second reading for host totals (`src/core/ps/snapshot.ts:63`, `:75`, `:87`, `:109`). The capacity caller supplies `host: null`. Shared file/process helpers have one module. The duplicate stage cost test and 650-process fixture are gone; the whole-snapshot cost test remains and passes. The model source uses the common in-memory source. The third drain state and measured-cost comments are updated. D4, D10 and D11 describe the resulting reads and modules.
- **Bundle boundary:** the full suite's `ps-bundle.test.ts` passes its source/import and size checks. Direct inspection of the four committed bundles gives the size ratio above, so this claim also covers the actual candidate artifacts without rebuilding them.

## Inputs for the next wave

Repair row 014-36 in `test/global-teardown.ts` and `test/global-teardown.test.ts`; B1 and S1 share that ownership. Preserve the short `/tmp` parent, daemon-key bypass, inherited temp variables, teardown restoration, and real killed-run test. Prove death in the recorded identity's scope before recursive removal. Keep foreign, unknown, noncanonical and other-user entries intact. Cover PID reuse without using another session's real files or signals.

The `ps` drop, decoders, install readers, lock wait rule, quality slices and bundle size need no repair from this review. A re-review should check the temp-sweep repair and its tests against this candidate, with any changed acceptance rule recorded by the coordinator.
