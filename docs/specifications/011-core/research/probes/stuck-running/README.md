# Probe: stuck-running (row 011-394)

**Throwaway.** These are research fixtures and drivers for [`../../stuck-running.md`](../../stuck-running.md). No product code depends on them, and no suite runs them. `node_modules` and run outputs stay out of git, except the summaries in `results/`.

## What is here

| File | What it does |
|---|---|
| `env.sh` | Source on the lab VM. Gives Squeal 0.1.563 its own `HOME`, `XDG_RUNTIME_DIR`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME` and `XDG_DATA_HOME` under `~/work/011-394/`, so no socket, capacity pool or user config is shared with another agent's Squeal. Installs the `sq` wrapper. |
| `unpack-runtime.mjs` | Unpacks the release asset `squeal-codex-runtime.json.gz` into `~/work/011-394/squeal`. |
| `make-fixture.sh` | Builds `syn`: 1,200 Vitest files that import `src/shared.ts` and sleep 60 ms, plus `test/hang.test.ts`. That file blocks its worker in `Atomics.wait`, without CPU, while `hang.on` exists. It sets `runner.timeoutMs` 120 s, tiers of 4 and lookup-only start. |
| `lib.sh` | `sqt` runs one bounded Squeal call and records its exit code, time and load in `calls.jsonl`. `pick` reduces a `status --json` answer. |
| `observe.mjs` | Samples the fixture's store read-only every 1–2 s. Per worktree it records the heartbeat age, the revision and listed (refined) revision, the open runs, the `pending` counts and the ended runs. |
| `timeline.cjs`, `runsof.mjs` | Print an `observe.jsonl` timeline, and the runs that hold a given file. |
| `e1-hang.sh` | E1: a hung tier, a named wait, a `run tests` request, a new file, then a restart. |
| `e1b-timeout.sh` | E1b: the same with nothing promoted. It watches the hung file to its timeout. |
| `e2-death.sh` | E2: the daemon paused for 75 s (`SIGSTOP`), then killed (`SIGKILL`) during a hung tier, then restarted. |
| `e3-claim.sh`, `e3b-claim.sh`, `e3c-claim.sh`, `e3d-claim.sh` | E3 to E3d: worktree A hangs at key K, and B reaches K four ways (see the findings). |
| `e4-listing.sh`, `e4b-edits.sh`, `e4c-restart.sh` | E4 to E4c on the cezar fixture: listing time after one central edit, under a stream of edits, and after a restart that stops a half-listed stream. |
| `results/` | Kept outputs: the step logs, the `calls.jsonl` files, the picks and the process snapshot. |

## How to re-run

The host is the lab VM the shared notes name (its topic note gives the ssh target, `<lab-vm>` below). Check `uptime` and `ps` there first, and run nothing heavy on the workstation.

```sh
# On the workstation: the release runtime, and a bundle of the fixture repository (no credentials).
gh release download squeal--v0.1.563 --repo hearsay-tools/squeal -p squeal-codex-runtime.json.gz
git -C <squawk checkout> bundle create cezar.bundle HEAD          # c11e4edf in this run
scp squeal-codex-runtime.json.gz cezar.bundle <this dir>/* <lab-vm>:work/011-394/
# On the VM:
cd ~/work/011-394 && . ./env.sh
node unpack-runtime.mjs squeal-codex-runtime.json.gz squeal
git clone -q cezar.bundle cezar && (cd cezar && timeout 900 pnpm install --frozen-lockfile)
./make-fixture.sh $W/syn 1200 60 120000
timeout 1800 sh ./e1-hang.sh $W/syn $W/out/e1          # then e1b-timeout, e2-death, e3*-claim <fixture> <out> <value>
timeout 2700 sh ./e4-listing.sh $W/cezar $W/out/e4 packages/contract/src/index.ts packages/cezar/src/delegation/settled-observation.test.ts
timeout 900 sh ./e4b-edits.sh $W/cezar $W/out/e4b packages/cezar/src/delegation/settled-observation.test.ts packages/contract/src/index.ts packages/cezar/src/config.ts
timeout 400 sh ./e4c-restart.sh $W/cezar $W/out/e4c                 # right after e4b, on its store
node timeline.cjs $W/out/e1b/observe.jsonl; node runsof.mjs $W/syn/.git hang.test
```

Each driver stops its daemons on exit (`trap … sq stop --until-start`), and each call it makes has its own `timeout`. At the end, check `pgrep -af 011-394`. Note that `pkill -f` with that pattern also kills your own ssh command. Then delete `~/work/011-394`.

## Limits

- `runner.timeoutMs` is 120 s in `syn`, not the reporters' 900 s. Times at 900 s are computed from source, not run.
- The hang is a blocked worker thread. A busy loop, a leaked child or a stuck RPC was not tried.
- E4 started from a fresh store with no results. So its files were `unknown` rather than known, and the edit queued only the 97–105 files that the edit cut kept.
- 011-395 loaded the same VM during E1b to E3c (load 4.8–9.5). Each step log gives the load per call.
- The drivers ran in the order E1, E1b, E2, E3, E3b, E3c, E3d, E4, E4b, E4c; the `syn` ones share one repository, so later runs start from earlier runs' edits and store.
