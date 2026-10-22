# Wave 5 review

FAIL c5c7797bb63ff13e712d07764b042d5d37b9d382

Four blocking findings, all **proven**. One nonblocking process note. Reviewed range: `89511aa3c..c5c7797bb`, main 0.1.250 to candidate `cand/0.1.252`. The candidate was HEAD throughout verification. No product code was changed. No end command printed by `ps` was executed.

## Verification

Installed dependencies before any `npm run` or `npx`. On the clean candidate tree:

```text
$ git rev-parse HEAD
c5c7797bb63ff13e712d07764b042d5d37b9d382
$ npm ci
added 196 packages, and audited 197 packages in 11s
$ npm run lint
> squeal@0.1.252 lint
> biome check .
Checked 1684 files in 1027ms. No fixes applied.
$ npm run typecheck
> squeal@0.1.252 typecheck
> tsc --noEmit
$ npm run build
> squeal@0.1.252 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.252 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
$ git status --short
(no output)
$ node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/check-version-bump.ts 89511aa3c c5c7797bb
version bump: 0.1.250 -> 0.1.252, ok
```

Each command exited 0. The install output above is abbreviated. The build left every committed plugin bundle unchanged, including Codex's bundles.

### Independent full suite

**Not completed; unverified.** The coordinator stopped the exact-SHA host-locked gate after receiving the proven blockers. The coordinator then explicitly instructed the reviewer not to wait for it or start another full run. No full-suite pass or failure is claimed. This does not change the four independently proved blockers.

`/tmp/014-w5-gate.log`:

```text
start 2026-10-22T00:14:31Z c5c7797bb63ff13e712d07764b042d5d37b9d382
stopped 2026-10-22T00:19:15Z by the coordinator: wave 5 review FAIL
```

`/tmp/014-w5-gate-full.log` contained only:

```text
 RUN  v5.0.3 /tmp/sq-w5
```

CI run `39698502760` targets this SHA. At the last observation, the Node 24 lint/typecheck/version-sensitive job passed and the three Node 22 shards were still running. That partial CI observation is not a full-suite verdict.

### Discriminating probes

Throwaway TypeScript probes used the candidate's exported functions and existing fixtures, through `node_modules/.bin/tsx`. They were removed after use. The output below preserves the relevant observations without temporary directory prefixes.

```text
mixed holders:
  pid 4100, lock A, flags []
  pid 4101, lock A, flags []
  pid 4102, lock B, flags []
second locks unreadable:
  holdsLock false, phase waiting
  no-lock: it has waited 10m for its lock, past 40 s; command kill 4100
outside sibling cleanup:
  cell <temporary-root>, child argument <temporary-root>-outside
  child exit [null, "SIGKILL"]
full snapshot failed second locks read:
  pid 800: phase waiting; no-lock, command kill 800
  stale-socket for that daemon's socket, command rm <socket>
  pool {slots:23, held:0}
  no unknown entry for the failed lock read
owner exited before daemon startup:
  ownerExited true, daemonState S, elapsedMs 2100, rootKept true
```

Separate checks spawned the committed `ps.mjs` and `squeal.mjs` in each of the four plugins. They compared exit code, stdout and stderr exactly for ten argument lists: `ps --bogus`, `ps --repo` outside a repository, `ps --leftovers --json`, `ps --help`, `ps --full -h`, no arguments, `--version`, `status --bogus`, `bogus`, and `help`.

```text
PASS 40 comparisons: exact exit code, stdout and stderr; four committed plugin bundles.
```

## Blocking findings

### B1. A failed second lock read still permits absence claims

**Proven.** `src/core/ps/discover.ts:73`, `src/core/ps/host.ts:66`, and the calls at `src/core/ps/snapshot.ts:91`.

D2 step 3 says: "a daemon is `waiting` (and `no-lock`), a socket file has no daemon and a permit is free only when both readings miss the lock". D8 says an unread value is `null` and named in `unknown`.

When the first reading misses a held lock and the second reading is unreadable, `lockedAgain` returns the first discovery unchanged. A first-reading `false` remains `false`. `readPool` also substitutes an empty list for an unreadable second reading. The final snapshot therefore claims absence from one reading.

Reproduction through `takeSnapshot`: use `makeHost`, `makeRepo`, `daemonProcess` and `writeProcesses` from `test/ps/fixture-stores.ts`; create a socket for the daemon and a `pool.0.lock`; write an empty fixture `/proc/locks`; in the injected window wait, remove that file. The real `createProcSource` returns `null` for the second reading. The snapshot reports daemon 800 as `waiting` with `no-lock` and `kill 800`, marks its socket `stale-socket` with an `rm` command, and reports zero held permits. It names no failed lock read. The separate missing-bundle flag in this fixture is unrelated.

**Fix, one worker:** merge the two readings with three states. A positive reading proves held. Only two readable negative readings prove absent. Otherwise preserve uncertainty, including socket ownership and pool/permit counts, and name it in `unknown`. Add snapshot cases for `[]` then `null`, and `null` then a positive or negative reading. The current unit test that requires `lockedAgain(first, null) === first` must change when the first reading contains negative claims. Keep both-readable absence and either-positive cases.

### B2. A passed lock suppresses a real duplicate on another lock

**Proven.** `src/core/ps/flags.ts:395` and `src/core/ps/flags.ts:405`.

D7's duplicate rule still requires detection when daemons of one root hold different locks. D2's amendment exempts two holders of **one lock file**, because the lock passed between readings. It does not exempt the whole root group when one lock passed.

For one root, let P1 and P2 have `holdsLock: true` with lock path A, and P3 have `holdsLock: true` with lock path B. A passed from P1 to P2 during the window, while P3 held B. The set of paths has size 2 and the holder list has length 3, so `atOnce` is false. The code enters the passed-lock branch and flags only nonholders. All three holders get no `duplicate` flag. P3's duplicate is hidden.

Reproduction used `modelHost`, `foundDaemon`, `workOf` and `modelOf` from `test/ps/fixture-model.ts`. The three daemons shared a root and had worktree ids `000000000000000a`, `000000000000000a`, `000000000000000b`. Their work records were current. `flag(model)` returned empty flag lists for pids 4100, 4101 and 4102. This extends the candidate's existing passed-lock test by one different-lock holder.

**Fix, one worker:** group holders by lock identity within each root. Exempt a transfer within one identity without suppressing conflicts between identities. Keep the original two-holder passed-lock case and the aged nonholder case. Add mixed groups `[A,A,B]` and `[A,A,B,B]`, and preserve the existing distinct-lock duplicate case. Commands must not identify a known holder as a proven nonholder.

### B3. Cell teardown can kill a process outside the cell

**Proven.** `test/evals/fake-cell.ts:256`.

The review brief requires that `removeRoot` "can kill nothing outside its cell". The new helper sends SIGKILL to every pid returned by `leftoverProcesses(f.dir)`. That existing function uses `pgrep -af <dir>`, a regular-expression substring search over a rendered command line. It does not check argument or path boundaries and does not establish process ownership.

A probe created a temporary cell directory, then spawned an owned disposable Node child with a single unrelated argument `<cell-directory>-outside`. That argument names a sibling, not the cell or anything under it. Calling the candidate's `removeRoot({dir})` killed that child with SIGKILL. The probe process itself did not put the generated cell name in its command line. No unrelated host process was used in the probe.

**Fix, one worker:** constrain teardown to processes owned by the cell. Track pids and start times at spawn, or collect candidates and validate exact argument/path boundaries plus cell ownership before signalling. Do not use a regex substring match as authority to kill. Add negative cases for sibling-prefix paths and unrelated arguments containing the cell name, beside the positive cell-daemon and harness cases. Keep the change within the eval test helpers; the older `evals/lib/daemon.mjs` helper is evidence for this new call's behavior, not a separate finding against older code.

### B4. A fake daemon survives when its owner ends before daemon startup

**Proven.** `test/evals/fake-cell.ts:59`.

Row 014-32 fixes fake daemons that outlive their cell when cancellation prevents teardown. The added owner's lifetime check is necessary when the root remains after a killed test. It must cover an owner that has already ended when the daemon starts.

If `FAKE_OWNER` names a dead or zombie process at startup, `life()` returns `null`, so `born` is `null`. Every interval then skips the owner condition because `born !== null` is false. With its root still present, the daemon stays alive indefinitely. A slow Node startup after test cancellation takes this path.

A probe used the exported `FAKE_DAEMON` block unchanged in a temporary script. A short-lived Node owner spawned that script detached, set `FAKE_OWNER` to its own pid, recorded the child's pid and exited. After the owner exited, the daemon was still in state `S` after 2.1 seconds, with a 500 ms polling interval. The root remained present. The probe killed its own disposable child and removed its root afterward.

**Fix, one worker:** when an owner is supplied and is already gone at startup, exit. Preserve the existing start-time comparison for a live owner and the root-removal check. Add a case where the owner exits immediately after spawning, before the fake daemon initializes, with the root kept. Existing tests only kill an owner after the daemon is fully running.

## Should-fix and nits

- **N1, proven, nonblocking process drift:** `docs/board.md:1031` still marks rows 014-31 to 014-33 running, and row 014-34 planned, although this candidate integrates the three rows and is under review. The coordinator owns this update. No board file was changed by the reviewer.
- No separate code nits.

## What fits

- The ordinary two-readable-sample path uses one lock read at each end of the window. Discovery, socket ownership, flags and pool attribution consume the merged result. A lock seen only in the second reading gets its work from the second store read. The accepted omission of first-sample escaped processes remains the limit recorded in `status.md`; it is not a new blocker.
- The pool takes the holder from the latest readable sample that shows each permit. It does not give a transferred permit to both daemons.
- The pure `[A,A]` lock transfer and an aged nonholder are covered. B2 concerns a mixed group that those tests omit.
- Fake daemons poll root existence and a live owner's identity. The new tests exercise root removal, later owner death and teardown of a running cell. B3 and B4 identify the missing negative scope and startup cases.
- `ps.mjs` calls the same `psCommand` as `main.ts`, installs the same stdout EPIPE handler, and delegates every other command and `ps --help`/`-h` to the adjacent full CLI. The 40 exact comparisons above cover usage errors and delegation. They do not compare two changing live-host snapshots byte for byte.
- The shared build adds `cli/ps` to all four plugins. The Claude Code bundle is 134,478 bytes; its full CLI is 2,440,825 bytes. The Claude Code and OpenCode plugin bins select it for `ps`; all four format-5 launcher copies are byte-identical and fall back to the full CLI when an older plugin has no `ps.mjs`. Pi's direct command keeps its documented full-CLI route.
- `squeal update` reads the numeric launcher format and copies a newer format. The unchanged comparison admits a 4-to-5 update. The update tests now cover 5-to-6, and the launcher test covers a plugin with and without `ps.mjs`.
- The version rises from 0.1.250 to 0.1.252. The build reproduces the committed bundles and version metadata. Goal 6's whole-command CPU verdict remains assigned to row 014-35 at load no greater than the CPU count, as amended; this review makes no claim that the live-host goal has passed.

## Inputs for the repair wave

1. One lock-state worker owns B1 and B2: `discover.ts`, `host.ts`, their snapshot/flag callers as needed, and `test/ps/`. Merge readings before evaluating absence or choosing commands. Distinguish unreadable from readable-empty. Treat transfers per lock identity. Keep exactly two lock reads, at the existing sample boundaries, and retain the cost fixture bounds.
2. One eval-helper worker owns B3 and B4: `test/evals/fake-cell.ts` and its tests. Establish cell ownership before sending a signal. Handle an owner absent at initialization, without waiting for a later identity change.
3. Rebuild all plugin bundles after the lock repairs and keep the version metadata consistent with the candidate claim. Re-run the checks on the repaired exact SHA, then request a bounded re-review of B1 to B4 and the delta. Do not land this candidate.
