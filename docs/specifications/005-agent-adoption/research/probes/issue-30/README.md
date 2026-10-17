# Issue 30 selector probe (throwaway)

Throwaway research, not part of the test suite. Run from the repository root on Node 24:

```sh
node --disable-warning=ExperimentalWarning docs/specifications/005-agent-adoption/research/probes/issue-30/selection.mjs > docs/specifications/005-agent-adoption/research/probes/issue-30/output.txt
cat docs/specifications/005-agent-adoption/research/probes/issue-30/output.txt
```

The first operation records one-minute load and CPU count. Above CPU count it skips the probe. It needs no dependencies, writes no store, starts no daemon and runs no tests or browsers. No `node_modules` is created or committed.

The script extracts the actual `selectNamedFiles`, `validClosures`, `worktreePath` and `realOrNull` functions from the installed 0.1.199 CLI and the committed checkout bundle, binding their original Node filesystem/path imports. For checkout TypeScript it strips only types with Node's built-in `stripTypeScriptTypes`. `testFileId` comes from the installed bundle. It evaluates only these functions, never the CLI entrypoint. Whole-input SHA-256 hashes are in the output.

The in-memory store has two server test files and 83 synthetic browser files. Every browser closure holds both tests and a source file, modelling the reported `packages/cezar/src/**` declared input. The first unit test imports that source. All closures were written by this worktree and are valid. The earlier issue-6 probe and the landed overlap regression exercise actual glob/closure assembly; this probe deliberately isolates selection from that machinery.

Five cases per target: each exact test path, the ordinary source, mixed test/source arguments, and an unmatched path. Assertions pin selection counts, browser counts, exact-file membership and unmatched counts. `output.txt` is the actual run, not a CLI status transcript. Synthetic browser names/counts model the report; they are not a capture of cezarion's current listing. It does not measure queue delays, pending-file verdicts, or the reported 60-second timeout.
