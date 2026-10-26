# Why the Cezar main checkout reused about half its tests

Use /researcher. Shape: research.

Answer why a recent pull in the human’s Cezar main checkout inherited only about 50% of test results although the work was done on this host in other worktrees. Locate the Cezar repository and its actual main checkout; do not mistake this Squeal worktree for it. Read spec 011 C1, C3, C7 and status.md. Start with the installed CLI status and the shared store’s current keys, result history and environment inputs.

1. What are the actual current, inherited and unknown file counts and versions?
2. For the missing results, what concrete key differences or absent records explain the misses? Quantify the main groups. Check environment and package inputs, observed closures, key/adapter versions, ignored build outputs and records produced before final integration.
3. Is this required invalidation, missing validation, or a reuse defect? Cite stored evidence and source. State what remains unknown.

Read-only on product, live checkouts and stores. Small offline probes are allowed. No full suite, no forced runs, no daemon restarts, no builds or dependency install. Do not read or print credentials. Commit findings to research/main-pull-reuse.md and any throwaway probes beneath research/probes/main-pull-reuse/. Own only those paths. Return a plain technical explanation and exact evidence.
