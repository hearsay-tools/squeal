# Issue 113 throwaway probe

This is a synthetic research fixture, not a product test or proposed fix.
It runs the real Squeal scheduler, keying and SQLite store with a fake passing
runner. It creates two test files and an ignored runtime descriptor in a private
temporary Git repository. It starts no daemon and no browser. It never accesses
the original Cezarion worktree. Cleanup closes the scheduler and store and removes
the temporary repository. Dependencies come from this checkout; do not commit
`node_modules`.

Run from the repository root:

```sh
pnpm exec tsx research/probes/issue-113/probe.ts > research/probes/issue-113/output.jsonl 2>&1
```

Before each of four cases the probe reads `os.loadavg()[0]` and `os.cpus().length`.
It skips that case if one-minute load exceeds CPU count. Each case observes at
most 2.5 seconds of scheduling or six run starts, then closes. A run takes 30 ms;
close lets an in-flight run finish. The four cases are slow/scoped/stable,
slow/scoped/rewrite, fast/scoped/rewrite, and slow/unscoped/stable. The runner
reports the descriptor read and optionally rewrites it during each passing run.
The slow slot uses a private directory and the real default host-load reader.

`output.jsonl` is the final four-case run on Squeal 0.1.369 at
`cbdfa22c5ef59a414a7217eb0202de738af0f13b`, Node v24.22.1. It contains load gates,
run IDs, completion states, current keys, pending phases, stored rows and applied
runtime policies. A passing result here means the fake runner returned a pass;
it does not mean a browser test ran.

The fast control and the unscoped slow control settle with results. Both scoped
slow cases complete six passes but store no results and remain queued. Each file
runs three times; this does not reproduce the original report's starvation of
one reader.
