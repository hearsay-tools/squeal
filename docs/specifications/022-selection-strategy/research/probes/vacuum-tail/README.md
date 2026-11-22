# vacuum-tail probe (row 022-08r)

Times each part of the prune's list-delete and vacuum slices on a store shaped like the bench's aged store, to find where review 0.1.593 B1's long lock holds come from. Results and conclusions: `tasks/022-08/notes.md`, "Repair 022-08r".

Run it on boat.dev only (`~/projects/notes/topics/boat-dev.md`), never on this host: the store is 8.6 GB and the timings need a quiet disk.

## Files

- `build-store.mjs <store> <rounds>`: a new store with `auto_vacuum = INCREMENTAL`, per round 500 `loaded_modules` lists of 46 KB and 5,500 small `results` rows in turn. 326 rounds give 163,000 lists, as `bench/age-store.mjs` with 326 rounds: 8.6 GB, about 2 minutes.
- `prune-probe.mjs`: runs the real `emptyLoadedModules` and then the real `vacuum` from `src/core/store/` on a traced connection. Per write transaction it writes one JSON line: the wait for `BEGIN IMMEDIATE`, each `DELETE` or `incremental_vacuum` step, the work before `COMMIT`, the `COMMIT`, the WAL frames written, and whether SQLite checkpointed inside the commit (read from the wal-index header in the `-shm` file, through one descriptor kept open). A `wal_checkpoint` the code runs itself is one more line. After each slice it pauses as the daemon's driver does (`turnGapMs`).
- `other-writer.mjs <store> <out> <seconds>`: a second process that writes one small row every 20 ms and records its wait for the lock: how long the prune really keeps other writers out.
- `run-remote.sh <rounds> <list-minutes> <vacuum-minutes> <name>...`: on the sandbox, for each bundle `prune-probe-<name>.bundle.mjs`: build a store, drop the page cache, run the probe with the other writer.
- `summarize.mjs <run dir>...`: Markdown tables per phase and slice kind, split by whether the commit checkpointed; the WAL's largest size; the other writer's waits.

## How to run

The probe imports TypeScript sources, so bundle it once per code version, from a tree where `src/` is that version:

```sh
esbuild=node_modules/.bin/esbuild
P=docs/specifications/022-selection-strategy/research/probes/vacuum-tail
mkdir -p /tmp/vt/push
$esbuild $P/prune-probe.mjs --bundle --platform=node --format=esm --outfile=/tmp/vt/push/prune-probe-repair.bundle.mjs
# For an older version: git archive <ref> src | tar x -C /tmp/vt/base, copy the probe to the same
# relative path under /tmp/vt/base, and bundle from there.
cp $P/build-store.mjs $P/other-writer.mjs $P/run-remote.sh /tmp/vt/push/
boat new --type default --no-env --ttl 21600 --name vacuum-tail --json
boat push <id> /tmp/vt/push --to /home/user/vt
boat ssh <id> -- 'cd /home/user/vt && (setsid nohup ./run-remote.sh 326 12 8 base repair > run.log 2>&1 < /dev/null &)'
```

Then fetch `/home/user/vt/out/` and run `node $P/summarize.mjs out/*`. The first run (`out-v1` in the notes) used the older form of the probe: no pauses between slices, and a `--checkpoint slice` mode that is superseded by the repair itself.

In a `boat ssh` command, stop processes with a bracketed pattern (`pkill -f "[r]un-remote.sh"`): a plain pattern also matches the remote shell running the command, and kills it.
