# Probes for `../../enotempty-cleanup.md` (row 011-333)

Throwaway. Nothing imports these files; delete them when the row closes.

- `rmsync-retry.mjs`: does `rmSync` with `maxRetries` outlast a writer that stops after 300 ms?
  `node rmsync-retry.mjs <private-scratch-dir>` under each Node version. It writes 20,000 files,
  which took 17–36 s per run on a loaded host; fewer files make the writer miss the sweep.
- `node-test-writers.ts`: which entries the node:test run makes again in its log folder after the
  run test's delete moment. From the repository root:
  `HOME=<private> TMPDIR=<private> node --import tsx docs/specifications/011-core/research/probes/enotempty-cleanup/node-test-writers.ts`.
- `late-writes.py`: reads an `strace -f -tt` log and lists what any process created in each run
  folder after its removal began. The trace was taken with
  `strace -f -tt -qq -e trace=mkdir,mkdirat,openat,open,creat,rename,renameat,renameat2,unlink,unlinkat,rmdir,symlink,symlinkat,link,linkat -o <log> node node_modules/vitest/vitest.mjs run test/harness/opencode-dispose.test.ts -t "input routed to the re-created instance"`
  with a private `HOME` and `TMPDIR`. Note: git's own temporary files during setup also count as a
  "removal began"; read the `rmdir` of the run folder itself (`grep 'rmdir(".*squeal-opencode-XXXXXX")'`)
  for the real start.
