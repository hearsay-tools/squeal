# Probes for `slow-tier-role.md` (row 004-74)

Throwaway. Nothing here is product code or a test. Every run used a scratch clone under
`/tmp/r74-<epoch>/` with HOME, the XDG directories, npm's cache and pnpm's store inside it,
`GIT_CONFIG_GLOBAL=/dev/null` and an explicit probe git identity (`env.sh` there). Squeal was
cloned `--shared` from this worktree at `b08779a8` (0.1.215), cezarion from the local
`/home/agent/projects/cezar` at `51190d494`; neither source repository was written. The eval
cells under `/tmp/squeal-evals-1001/cells` were only read. The scratch root was removed
afterwards. Probes ran only while the 1-minute load was below 24 (the CPU count), at 7 to 20.

| File | What it does |
| --- | --- |
| `a2-tally.sh` | Per a2-slow eval cell: slow file current at the final revision, and whether the agent ran `run --slow`. Output `logs/a2-tally.txt`, split by run in `logs/a2-by-run.txt`. |
| `rebuild-diff.sh` | Squeal clone: one sed edit, `npm run build`, list the plugin dist files whose bytes changed (`logs/changed.<label>.txt`). |
| `trace-e2e.sh`, `trace-map.mjs` | Each `test/e2e` spec under `strace -f` (openat, execve), three at a time, nice 10; maps every copied plugin root back to its source plugin and lists the plugin files each spec opened (`logs/trace-map.json`, `logs/trace-e2e.txt`, `logs/rekey-squeal.txt`). |
| `cz-rebuild-diff.sh` | Cezarion clone, `packages/cezar`: append one export to a module, `npm run build` (tsc and inline-contract), list changed dist files (`logs/cz-changed.<label>.txt`). |
| `cz-trace-map.mjs` | One `strace -f` (openat, execve, clone, fork) of `test:package`; ties every process to its spec by the first spec file it opens, lists the dist files per spec, and which specs opened a changed file (`logs/rekey-cezar.txt`). |
| `fast-beside-slow.sh` | A 4-file fast tier at nice 10, alone, then beside a slow lane (two e2e files, nice 10, ionice idle, `--maxWorkers=2`, its own process group). `logs/fast-beside-slow.*.txt`. |

Limits: strace slows every process (spec times in `trace-e2e.txt` are traced, about 2 to 5x
plain); `strace` sees opens, so a file read with `fs` counts like an import, and a spec that
skipped (`pytest`, `torn-status` here, opt-in) opened nothing. The traced cezarion run had no
`web/dist` built, so `package-cli` failed 2 tests after it had already opened all of `dist`.
One e2e daemon from the first `fast-beside-slow` pass outlived the stopped loop (its fixture
under `/tmp/squeal-e2e-*`); it was stopped by pid after checking its HOME was the scratch one.
The e2e fixtures' own `/tmp/squeal-e2e-*` and `/tmp/squeal-ship-*` directories cannot be told
apart from other workers' runs on this host, so they were left in place.
