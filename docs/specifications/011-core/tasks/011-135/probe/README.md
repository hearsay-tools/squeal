# Row 011-135 probe

Throwaway scripts for `../design.md`. No Squeal daemon is started or reached, and nothing here runs a script under `evals/bin/`. Every script sources `env.sh`, which puts `HOME`, every `XDG_*` directory, `TMPDIR` and the npm, pnpm and corepack homes under one scratch root `S` in `/tmp` and refuses any other root.

| Script | What it does | Output |
| --- | --- | --- |
| `env.sh` | the isolation above; `REPO=$S/repo` | |
| `setup.sh` | clones cezarion from the local checkout at `6a4db210` (the first commit of cezarion PR 1384, which closed cezarion#1269) and runs `pnpm install --frozen-lockfile` through corepack (pnpm 12.11.2) | Vitest 4.1.10 installed |
| `measure.sh` | each parity file run whole with the clone's Vitest CLI, then `-t` on the two checks whose assertions PR 1384 changed (`U2 ci and timer open`, `U3 a human message during a ci wait`); `red` puts `run.ts` at `6a4db210^`, so those assertions fail; `green` at `6a4db210`. It waits for a one-minute load below 16 before each run and prints the load at its start | `results/cli-red.txt`, `results/cli-green.txt` |
| `warm.mjs` | one Vitest instance, as the daemon holds one per worktree (013 V1): the whole file, then the two checks twice through the per-specification `testNamePattern`, each `runTestSpecifications` timed | `results/warm-red.txt` |
| `run-all.sh` | the driver: `measure.sh red` on all seven parity files, `warm.mjs` on two, `measure.sh green` on one | |
| `spec-filter.mjs` | one specification with a `testNamePattern`, through Vitest's node API; prints every `onTestCaseResult` and `onTestModuleEnd` | |
| `filters.sh` | the name filters on a fixture of four checks: Vitest 4.1.10 (the clone's modules) and 5.0.3 (this worktree's), node:test on the host's Node 24.21, pytest 9.1.1 in a venv under `S` with a stand-in deselection hook | `results/filters.txt` |
| `summarize.py` | one line per CLI run with the load during it, from the samples below: `python3 -I summarize.py results` | `results/summary.txt` |

`results/load-samples.txt` is the one-minute, five-minute and fifteen-minute load every 10 s during `run-all.sh`, sampled from `/proc/loadavg`, from 07:27:12Z to 09:21:30Z on 2026-10-23.

On 2026-10-23 `run-all.sh` stopped at its two-hour bound after seven runs (`results/cli-red.txt`): the load stayed above 16 from 07:59Z, so `warm.mjs`, the green run and four files did not run (`../design.md`, section 6.2).

Re-run: `S=$(mktemp -d /tmp/d1-135-XXXXXX); S=$S sh setup.sh && S=$S sh run-all.sh && S=$S sh filters.sh`, then `rm -rf "$S"`. The parity checks start `mock-claude.mjs` and other mock harness processes under `$S`; after a run, list leftovers with `ps -eo pid,args | grep -F "$S"`.
