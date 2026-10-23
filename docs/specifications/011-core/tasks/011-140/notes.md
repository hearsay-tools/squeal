# 011-140: a Codex kept copy runs only the code its name says

Worker 896f1939, wave 23 W1, from `int/w22` at 016013a6b (0.1.275 candidate), 2026-10-23.

## 1. The writer

**Named: `test/harness/opencode/latency.test.ts`.** It hands `process.env` to the bundled Codex hooks ("The Codex hooks get the environment the bridge inherits"). When the test run inherits a Codex hook's `PLUGIN_ROOT` and `PLUGIN_DATA` (a run under a daemon a Codex hook spawned, or a Codex reviewer's shell), the built `session-start` bundle keeps a copy named for this tree's version (`squealVersion()` baked into the bundle from `package.json`) and fills it from `PLUGIN_ROOT`, the installed older plugin.

How it was found (verified by experiment, this tree, 2026-10-23 10:40Z):

1. A scratch plugin root (`dist/cli/squeal.mjs`, `skills/`, `bin/squeal-launcher`, manifest 0.1.200) and an empty scratch data directory, with scratch `HOME` and `CODEX_HOME`.
2. A temporary line in `keepVersion` (not committed) appended each call's `root`, `data`, `version`, `argv`, `cwd` and stack to a log.
3. `npx vitest run test/harness test/plugins test/real-cli --maxWorkers=4` with `PLUGIN_ROOT` and `PLUGIN_DATA` set to the scratch directories: 121 files, 213 s. The scratch data directory then held `versions/0.1.275` (the fake 0.1.200 code) and `bin/squeal`. The log named 6 calls, all from `/tmp/sq-codex-*/session-start.mjs` through `runMain` → `runCodexHandler` → `sessionStart` → `keepCodexVersion` → `keepVersion`.
4. `test/harness/opencode/latency.test.ts` alone with the same variables: a copy without the isolation below, none with it (both on the old `keepVersion`).

After the fix (39e614a30), `npx vitest run test/daemon test/harness --maxWorkers=4` with the same scratch variables, `HOME` and `CODEX_HOME`: 211 files, the scratch data and Codex directories still empty afterwards. Not run with the scratch variables: the other directories (`test/cli`, `test/scheduler`, ...). Every other `keepVersion` caller in the source takes its environment from the caller (`keptCacheCli` in `start.ts`) or from `process.env` in a bundle (`main.ts`). The bundle runners in `test/harness/bundle-helpers.ts` pass a minimal environment. So no other test reached it in the run above. The global setup clears both variables for every directory in any case.

**Isolation.** `test/global-teardown.ts` (the Vitest global setup) deletes `PLUGIN_ROOT` and `PLUGIN_DATA` before the workers start, as it sets `TMPDIR` for them (task 014-36), and puts them back at teardown. Test: `test/global-teardown.test.ts` "row 011-140: clears PLUGIN_ROOT and PLUGIN_DATA ...".

## 2. What changed

| Done-when | Where | Test |
| --- | --- | --- |
| A root of another version makes no copy | `keepVersion` reads the root's `.codex-plugin/plugin.json` and copies only when it names the copy's version; it then writes no launcher either | `test/harness/shared/version-copies.test.ts` "makes no copy and writes no launcher from a root of another version" |
| A copy of other code is not used and is made again | the copy keeps the root's manifest (`COPIED` gains `.codex-plugin`); `keptCli` and `keptSkill` return a copy only while its manifest names its version; `keepVersion` renames a copy of other code, or one without a manifest, out of `versions/` first | same file, two `it.each` cases and "renames a copy of other code out even when its root is of another version"; `keptCacheCli` "makes the copy again ..." |
| A PostToolUse bundle with `PLUGIN_ROOT` of another version | (the above) | `test/harness/codex/version-copies-hook.test.ts`: B's bundle with A's root keeps no copy and spawns B from its own bundle; a B hook that finds the copy named B holding A makes it again and spawns B from it. Both fail on the old code (daemon at A). |
| A successor older than its claim: no second step-down, one notice | `endHandoff` (`src/core/delivery/handoff.ts`), called by `#register` in `daemon.ts` instead of `clearHandoff`: with a live claim to a newer version, a `daemon-handoff-short:<worktree>` mark (`ShortHandoff`) and one note. `handOver` (`src/harness/shared/ensure.ts`) returns `none` for the marked incarnation. `withStopping` adds `short` (`DaemonShort`) to an alive liveness; `livenessChange` tells it once, told slot `{ short: <incarnation> }`. Texts: delivery title, header sentence, status daemon line | `test/harness/handoff-short.test.ts` (6), `test/daemon/handoff-claim.test.ts` "row 011-140: ends short ..." |
| ... and status and the notice name `squeal start`, which replaces it | `replaceShort` in `src/cli/start.ts`: a newer `start` asks the marked daemon to step down (`stepDownIfOlder`) and finishes the handoff | `test/daemon/start-short.test.ts`; fails without `replaceShort` ("Squeal daemon alive") |
| Three versions and a store writer: one handover, one daemon of the hook's version | (the above) | `test/harness/codex/version-copies-loop.test.ts`, from `probes/issue-75/three-versions.mjs`: copies C→B and B→A, a daemon of A, Codex PostToolUse of C every 300 ms for 12 s, a writer holding `BEGIN IMMEDIATE` for 2 s. One step-down note, one daemon of C from a remade copy, later hooks leave it. On the old copy code no daemon of C serves within 60 s. |
| The daemon records its executable (drafted C9) | the token row keeps `executable` (`process.argv[1]`), read back as `DaemonRecord.executable` | `test/store/daemon-token.test.ts`, `test/daemon/handoff-claim.test.ts` |

Review 0.1.277 repair (worker 896f1939): `handOver` reads the record, the claim, the short mark and the other sessions' versions in one read transaction and decides from that record, so a hook never reads the old record with its successor's mark (B1). `replaceShort` pings first, asks only the incarnation the mark names, and on acceptance returns it as stopping without reading `stoppingDaemon` again, so `start` finishes the handoff and never says `alive` (B3). A narrow window stays: between the snapshot and the socket connect, another hook's accepted step-down, claim and successor bind could make this hook ask the short successor.

Type changes, all additive: `DaemonShort` and `DaemonLiveness` alive `short?`; `DaemonRecord.executable?`; `ToldLiveness` gains `{ short: string }`; `WORKTREE_META_ROWS.daemonHandoffShort`; exports `endHandoff`, `readShortHandoff`, `shortHandoffMetaKey`, `ShortHandoff`, `Registering`, `shortText`, `toldOf`.

Outside the row's file list: `src/core/daemon/daemon.ts` (the `#register` call and the executable, about 10 lines; no sibling owns `src/core/daemon/`), `src/core/delivery/{delivery,format,header,liveness}.ts` (W1's area by the brief's W2 list), `src/core/status/status-detail.ts` (one line), `src/core/types/{status,store,store-records}.ts` (additive), `test/global-teardown.ts`.

## 3. Decisions the spec did not settle

1. **What names a copy's code.** The root's `.codex-plugin/plugin.json`, copied into the copy. The bundles and the manifest get their version from the same build step (`writePluginVersions`, `__SQUEAL_VERSION__`). Reading it costs one small file read per hook.
2. **A wrong copy that a running daemon uses is still renamed out.** That daemon runs older code under a newer name, and the hook steps it down anyway; its later loads by path fail as it exits. Sparing it would leave the wrong copy in place for the launcher.
3. **The short mark is its own `meta` row**, not a field of the claim: a release before this row would read a claim row with a live bound as a live claim.
4. **`squeal start` replaces only a marked daemon.** A newer `start` still says `alive` for an older daemon without the mark, as before; hooks step that one down.
5. **The notice** is the liveness title `a 0.1.272 daemon is validating at revision N, not 0.1.273` and the header sentence ``The daemon is up: the handoff to 0.1.273 ended at <time> with a 0.1.272 daemon, which validates; no hook asks it to step down again, and `squeal start` of 0.1.273 replaces it.``

## 4. Drafted spec sentences (the coordinator writes them)

**005 D3**, after "...and a hook that spawns nothing copies nothing (amended 2026-10-23, row 005-81).":

> A copy also keeps its plugin root's manifest (`.codex-plugin/plugin.json`), and is made only from a root whose manifest names the copy's version. A hook or `squeal start` uses a copy only while its manifest names its version. A copy without a manifest, or with another version, is renamed out of `versions/` and made again from the hook's own root, and until then the hook spawns from its own bundle. A root of another version makes no copy and writes no launcher (amended 2026-10-23, row 011-140, `research/issue-75-77.md` Q1 and Q4: on this host `versions/0.1.273` held 0.1.272 code, made by a test run of unreleased code under a Codex hook's `PLUGIN_ROOT`; Squeal's own test setup clears `PLUGIN_ROOT` and `PLUGIN_DATA`).

**011 C9**, after "The claim ends when its successor registers (in the registering transaction), when that successor's lock wait ends without the lock (in its note's write), or at its bound.":

> A successor that registers older than the live claim it ends ends the handoff short, in the registering transaction: one note names the claim's version, its own and the executable it runs, and a mark names its incarnation. No hook asks that incarnation to step down again. It validates at its own version; the next liveness notice to each consumer, the delivered header and status say so and name `squeal start`, and a `squeal start` newer than it asks it to step down and finishes the handoff. Any other registration clears the mark (amended 2026-10-23, row 011-140, `research/issue-75-77.md` Q2: each successor from a wrong copy registered old and was stepped down again, 39 incarnations in 180 s).

**011 C9**, in the registration paragraph ("The winner ... records the path and a heartbeat in the store"):

> It records the executable it runs beside its version, in its start token's row (amended 2026-10-23, row 011-140: the store kept none, so which file a wrong-version daemon ran could not be read).

## 5. For whoever continues

- The launcher (`plugins/*/bin/squeal-launcher`, format 6) still runs the newest copy without reading its manifest. After this row a hook renames a wrong copy of its own version out; a wrong copy of a version no hook runs any more stays until pruned. Not in this row's files.
- Bundles are not rebuilt (no `npm run build` in this row): `plugins/*/dist` drift fails the four bundle tests until integration.
- The scratch-variable runs covered `test/harness`, `test/plugins`, `test/real-cli` and `test/daemon`, not the whole suite (section 1).
- `squeal start` asks the short daemon with the CLI's socket timeout (`askDaemon`), not the hooks' 100 ms: under Squeal's own run at load 2.2 per CPU the 100 ms ask timed out once.
