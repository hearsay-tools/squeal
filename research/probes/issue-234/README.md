# Issue 234 throwaway probes

These probes are research only. They change no product code. They refuse to run
when one-minute host load exceeds CPU count. Temporary repositories and stores
are removed at exit. No full suite or build runs. `node_modules` is never copied
or committed.

`live.mjs` starts the pinned CLI's real daemon in a new git repository, with two
one-test Vitest files, one manual group named `run-loop`, lookup-only baseline,
one Vitest worker, and coverage and complexity disabled. It links the checkout's
installed dependencies (Vitest 5.0.3). It runs the narrow request twice, reads
selected status between the requests, then stops only its fixture daemon.

From the repository root, the exact command used was:

```sh
node research/probes/issue-234/live.mjs \
  ~/.codex/plugins/data/squeal-hearsay/versions/0.1.531/dist/cli/squeal.mjs \
  node_modules > research/probes/issue-234/live-output.txt
```

The output replaces only the temporary root with `<fixture>` and the home path
with `~`. The test commands and verdicts are unchanged.

`snapshot.ts` seeds one current file in an isolated store and calls the real
`waitForGroup`. Its first stdout callback queues that same file before the
subsequent status read. This injects a deterministic interleaving; it does not
measure its frequency or reproduce a real daemon's timing. A second call starts
with that file already pending and an expired deadline, as a negative control.
It does not run a test runner or start a daemon. The synthetic daemon record has
no socket server; the settled and expired-deadline branches do not need one.

```sh
pnpm exec tsx research/probes/issue-234/snapshot.ts \
  > research/probes/issue-234/snapshot-output.txt 2>&1

probe_source=$(mktemp -d /tmp/sq234-source-XXXXXX)
git archive squeal--v0.1.531 src package.json | tar -x -C "$probe_source"
ln -s "$PWD/node_modules" "$probe_source/node_modules"
pnpm exec tsx research/probes/issue-234/snapshot.ts "$probe_source" \
  > research/probes/issue-234/snapshot-531-output.txt 2>&1
probe_code=$?
rm -rf "$probe_source"
exit "$probe_code"
```

The first source run used checkout `b0da5d149d445ea92c8517497141a7ed6dbbcc96`
(0.1.543). The second used source from tag `squeal--v0.1.531`, commit
`daf50f82e48e697545cfb7a378f4d46b03ce8a27`. Both used the checkout's installed
TypeScript loader and dependencies. Results were the same: injected change
prints completed plus queued and returns 0; pending-before-read returns 3.
