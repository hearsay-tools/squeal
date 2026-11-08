# Spec 018 wave 3: the trial

## 018-08 trial: CI export imported into a fresh cezar clone

Use /researcher. Shape: research (an experiment; no product code).

Outcome: how many of cezar's test files become current in a developer clone from CI's export alone, and why the rest do not.

Read: `spec.md` D5 and D7; `research/main-results.md` 3; `reviews/wave-2.5.md` "Inputs for the repair and next wave" (the trial must wait for adoption before counting); `tasks/018-07/notes.md`.

Inputs: cezarion run `<RUN_ID>` of `squeal-results-trial.yml` at main `<SHA>` (Node 24.22.1, Squeal `squeal--v0.1.417`). `gh run download <RUN_ID> -R hearsay-tools/cezarion` gives `squeal-results.json.gz`; `gh run view <RUN_ID> --log` gives the job's step times and the `squeal run --all` output.

Use Squeal 0.1.417 from a shallow clone of the tag under `$TMPDIR` (`node <clone>/plugins/claude-code/dist/cli/squeal.mjs`), not the host's installed plugin, which may be older. Node: `node --version` must print v24.22.1; say so if not.

Step 0, first (added 2026-11-08 after the first trial run failed). Run 42482427002 at `bed82fdb` failed in about 1 minute with no export: `squeal run --all --wait` exited 3, "Checkpoint ... has no verdict: revision 1 was recorded after the checkpoint's revision 0", and status showed `bed82fdb + 1, dirty` 20 s after the start, with the `browser` group (`at: manual`, 98 files) counted in the 1,843 files to run. Find, from the job log (`gh run view 42482427002 -R hearsay-tools/cezarion --log`), Squeal's source at `squeal--v0.1.417` and cheap probes in a fresh clone (start the daemon with lookup-only and watch whether the revision moves before any test runs; read which of cezar's tests write into the worktree; `git status --porcelain --ignored`), which change made revision 1 and whether `run --all` waits for the manual group. Then propose the smallest change to the trial workflow (for example a `.gitignore`d output path, a wait for listing before `run --all`, or a retry of `run --all` on a moved revision) and stop: report it to the coordinator before counting, since a new cezar change needs the human. Do not run cezar's full suite locally; a few chosen test files are fine.

Counts (after the coordinator relays a successful run's id):

1. **Import alone.** A fresh `git clone` of cezarion at `<SHA>` under `$TMPDIR`, `pnpm install --frozen-lockfile`, its own empty store. `squeal import <file>` (keep its output), then `squeal start` (cezar's config is lookup-only, so no test runs), wait until the daemon has keyed every file and adopted the import (`squeal status --full --json` stable over two reads a minute apart), then record: test files current from the import, of all test files, and the D5 reasons for the rest, per Vitest project. Name every environment difference status reports.
2. **What the shared store already gives.** A second fresh clone at `<SHA>` whose `.git/squeal/` holds a **copy** of `~/projects/cezar/.git/squeal/store.sqlite` (with `-wal` and `-shm`), taken with the daemon state as it is. Start without importing and count current files (inherited); then import and count again. Never open the live cezar store for writing.
3. **Cost.** The CI job's wall time per step, the `run --all` time, and the export file's size.

Owns only `research/import-trial.md` and `research/probes/import-trial/`. Run no cezar test suite locally. Stop every daemon you start (`squeal stop`) and delete the clones before finishing. If the host's one-minute load is above its CPU count, wait before starting a daemon.

Done when `research/import-trial.md` is committed with the three counts, every reason and environment difference, the commands and their output excerpts, each finding tagged as `research/README.md` says, and a recommendation for the next slice (transport, `CI=true` tolerance, the observed-set rule).
