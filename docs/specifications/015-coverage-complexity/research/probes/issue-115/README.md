# Issue 115: throwaway probe

This is research, not a product test or a new counting path. Run from the repository root:

```sh
timeout --signal=TERM --kill-after=5s 45s pnpm exec tsx docs/specifications/015-coverage-complexity/research/probes/issue-115/probe.mjs > docs/specifications/015-coverage-complexity/research/probes/issue-115/output.jsonl 2> docs/specifications/015-coverage-complexity/research/probes/issue-115/stderr.txt
```

The script refuses live work when one-minute load exceeds the CPU count. It creates temporary source files and a private code store below this directory, then removes them in `finally`. A forced kill can leave `.scratch-*`; remove only those probe directories after checking that this command stopped. No dependencies are installed, no daemon is started, and no suite or build runs.

Two fixtures are exactly 611,328 bytes (597 KiB). Both start with one TypeScript function with 22 `if` statements, so expected CC is 23. The first fills the remaining bytes with one comment. The second adds 9,147 simple functions before its final comment. These are not copies of cezarion's source.

The script calls the real policy loader, code pass, SQLite code store and tree-sitter counter. Its `PassSource` supplies a synthetic successful listing at revision 1. It first checks the default limit, then writes a private config with `complexity.maxFileBytes: 1048576` and repeats the pass. Another worktree ID shares the same blob and store. One extra direct count measures a warm parser without the count cache.

`output.jsonl` is the successful run; `stderr.txt` is empty. `attempt-1.*` preserves the first run, which stopped on a probe assertion using `state` instead of the actual `outcome` field. The counter had already stored `outcome: "fail"`. The corrected run exited 0. This was a probe defect.

Counting times use `performance.now()` and process CPU usage around `countFile`; the first call includes grammar startup. Pass wall time also includes reading the stored rows for output; pass CPU is sampled just after `runPass`. CPU may exceed wall time because it covers all process threads. These few samples are not a latency percentile or a daemon responsiveness benchmark.
