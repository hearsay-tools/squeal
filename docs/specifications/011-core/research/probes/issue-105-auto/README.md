# Throwaway probes for 011-261

These files are research evidence, not product code or a proposed filter. `probe.py` creates the fixture in a temporary seed repository, commits it there, then clones it before execution. It never runs another research probe, an eval, a browser, or a Squeal daemon.

## Repeat

From a Squeal checkout with dependencies already installed:

```sh
bash docs/specifications/011-core/research/probes/issue-105-auto/run.sh \
  "$PWD" /home/agent/projects/cezar > /tmp/issue105-auto-results.ndjson
```

To repeat only the recorder/verdict experiments without copying stores, append `fixture` as the third argument. Requirements: Linux, `git`, Python 3, Node, `strace`, and the checkout's installed Vitest. Examined versions are printed in the first record. No installation or network fetch runs.

`run.sh` creates `/tmp/issue105-auto-*`, uses `env -i`, clears inherited plugin variables, and sets HOME, USERPROFILE, XDG paths, TMPDIR/TMP/TEMP, CODEX_HOME, PLUGIN_DATA and package-manager caches beneath that directory. All experiment children inherit nice 10. Only the clone's fixture config is loaded. The fixture uses the existing `node_modules` through a git-ignored symlink; Vite's cache is local `.cache`, and no installed files are changed. No credentials are forwarded. The wrapper removes the temporary tree on exit. Each test invocation has a private process group and a 90-second deadline; timeout cleanup signals only that group.

## E1a: copied-store inventory

The script copies each repository's `store.sqlite`, `-wal` and `-shm` as bytes, then opens only the copies. It runs `PRAGMA quick_check` and prints selected schema fields, observed ignored paths/readers and retained revision counts. Serial file copies are not an atomic snapshot; integrity checks support this inventory, not an exact causal reconstruction across concurrent writes. It never opens a live store through SQLite or connects to a daemon socket. Raw database contents are not committed.

Ignore classification uses clones plus copies of `.git/info/exclude` and the `.gitignore` files above observed paths from each main checkout. This matters for the untracked `.ai/cezar/.gitignore`. The log gives the main commit used for those rules; local rule files need not be tracked by that commit. No global excludes file was configured on this host. `git check-ignore` rejects twelve Squeal paths beyond tracked symlinks; the log names them as unclassified. Counts concern the remaining paths, not a claim that rejected paths are irrelevant.

These copies have unions of observed paths, not a record of each write/read sequence. The probe therefore does not pretend to recover an exact “every reader run caused this write” classifier. Revisions record changed content, not all writes. SQLite copy/check timings include both operations and carry load before/after.

## E1b: producers and readers

The generated fixture has eight small Vitest files. Setup writes:

- `.ai/qa/test-env.json`, `.ai/qa/build/out.txt`, `packages/cezar/web/dist/index.html` and `.ai/qa/declared.json` through a shell's `printf`;
- a PID/nonce-shaped state/build pair directly from Node;
- a second identical-shaped pair through shell → Node, matching Cezar's actual descriptor producer.

The build includes a changing nonce and `GOOD` content. This is a counterexample to “changes every run means state”; it is not a claim that Cezar's current web build is nondeterministic. The declared JSON is listed in `squeal.config.json` and read by its test. The fixture does not start Squeal, so declaration/key behavior is established separately from source and the earlier issue-105 daemon experiment. Installed lockfiles are not modified.

Three full fixture invocations use one worker: two identical runs with the stock worker recorder, then one with the recorder also preloaded in the main process using synthetic `GLOBAL_SETUP` attribution. The latter is wrapped in `strace -f -e trace=openat`. Only syscalls naming the eight probe targets are retained in the log. The stock recorder preserves no event order; syscall times prove the setup writes precede the worker reads. Synthetic attribution establishes that Node hooks can reach these writes; the current adapter does not deliver those project-level writes to completed test files.

Expected: 8/8 pass in all three runs; all eight files change between the first two; worker read records have no target writes. Main attribution adds the four Node-written targets, including shell → Node, but not pure shell output. Both state/build pairs have identical bytes within each pair, so JSON shape is not a reliable distinction.

## E1c: independent run and real inputs

One direct run selects only `e2e/d`, whose assertion reads no target. Its setup changes all eight ignored files, while its recorder reports no target read/write. No Squeal run is in progress. This reproduces the causal shape of the incident without starting a browser or a daemon. It does not repeat the prior research's measured revision/key transitions.

Five single-file invocations then skip setup. Each changes one tested output from `GOOD` to `BAD`, or changes a Node output's positive `pid` to zero. Each exits 1 with exactly one failed test, as expected. They prove that a path a broad classification would omit can change a real verdict. These deliberate assertion failures are counterexample evidence, not product regressions. Each invocation also asserts clean `git status`.

`results.ndjson` contains all verdicts, target hashes, observation sets, selected syscalls, loads and elapsed times. Wall times are single samples under changing host load, not overhead estimates. `results.stderr` is empty on the final successful run. The final `finished` record means every test child exited; the wrapper then removes both source clones, fixture, seed, store copies and traces. No full project suite, typecheck or product build is required for these research-only files, and none was run. The brief forbids live sockets, so this task does not call `squeal status` against the session daemon.
