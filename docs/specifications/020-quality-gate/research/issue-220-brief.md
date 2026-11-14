# Research brief: completed gate results dropped while another worktree's daemon holds the store (#220, with #216)

Approved by the human on 2026-11-14 ("#220: Research first", "Then: Fold #216 in"). Researcher: one, `/researcher`. Budget: about 90 minutes. Read-only on the product. Own only `research/issue-220.md` and `research/probes/issue-220/`.

## The issue

[#220](https://github.com/hearsay-tools/squeal/issues/220), on 0.1.503: a `squeal code --base origin/main --json` run in the Squawk repository (`~/projects/cezar`) selected 1,131 test files at a load of 54–72 on 24 CPUs, spent its 600 s budget, and did not keep 333 completed files: 224 because "the store stayed busy for 30 s" (holders: daemons of other worktrees, `@0c6fd671`, `@dc937452`), 109 because "what their keys name changed during the run" (the reporter blames another task's commit touching `.github/mutants/*`). 29 files were kept while the runs went on. Rows 020-59 (0.1.495, keep per chunk) and 020-28 (the 30 s bound, `KEEP_BUSY_BOUND_MS` in `src/core/code/gate/keep-write.ts`) are the current design; read spec 020 D17.3 and D17.5, `research/issue-201.md`, `research/issue-216.md`, and `tasks/wave-22-020-59/notes.md`.

## Questions, in this order

1. **Why does a store stay busy for 30 s or more?** Each write should be a short transaction in busy slices. Find which daemon work holds the shared store's write lock that long, or whether several writers take turns so the gate never gets a slice. Read the store write paths (`src/core/store/`, `src/core/daemon/`, `slicedWrite`, `busyBackoffMs`) and spec 021 on contention. Probe it on a scratch repository with its own stores and HOME.
2. **Were the 109 "changed" files a true change?** Find what the gate's change check reads for a key's inputs, and whether anything shared between worktrees (git common dir, refs, packed objects, an ignore or attributes file, a directory listing) can make a file read as changed when this worktree's bytes did not move. Check, read-only, whether `.github/mutants/*` is in those keys in the Squawk repository, and what touched it near 2026-11-14T21:30Z (`git log --all`).
3. **Fix options and their cost.** (a) Retry until the command exits; (b) a side file of completed results outside the locked store, folded in by the next gate or by the daemon, with how the key's validity holds at fold time; (c) any better option the evidence shows (a bound scaled to the saved work, routing through a daemon). For each: what can be lost, how long the command can wait after its report, and the files it touches. Also the report line the issue asks for: how many completed files the run kept.
4. **#216.** Do 0.1.495 to 0.1.506 resolve #216's case (a 51-minute incomplete report on an overloaded host with no way to complete it)? Name what remains, if anything.

## Limits

- Never touch real daemons, the real HOME or `~/projects/cezar` beyond read-only reads; copy any store file to `/tmp` before reading it. Never run `evals/bin/*.mjs`.
- Timing probes only while the one-minute load is at most 24; record the load beside every timing. Code reading and deterministic probes (a fake lock holder in a scratch repository) are allowed at any load. Never create load on purpose.
- No full suite; no `pnpm run build`.
- The store and daemon code belong to specs 011 and 021: propose there, change nothing.

## Output

`research/issue-220.md`: answers tagged by evidence (verified by experiment, read in code, inferred), a recommended design for spec 020 D17.5 (and any 011/021 row it needs), the open decisions for the human in plain words with cost, and a row split (files, order, tests per row). Commit it in your worktree.
