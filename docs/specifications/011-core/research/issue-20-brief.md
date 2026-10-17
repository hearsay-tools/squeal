# Research brief: issue 20, setup failures under Squeal's own tmp root

Use /researcher. Shape: research, read-only on the product. Decided by the human on 2026-10-17 (triage row gh-20, "reproduce first"): the policy question, whether a setup filesystem error under Squeal's owned tmp root gets one automatic retry outside 011 C5's agent-only retry, is answered only with evidence. The triage (`issue-20.md`) could not run anything at load 57; run only when the one-minute load is below the CPU count.

Read first: [issue #20](https://github.com/hearsay-tools/squeal/issues/20) and its comments; 011 C5 (retry and counting), C13 (error handling); 013 V8 (runner failures); 004 D4 (interruption and stability); `issue-20.md`.

Questions, each answered with its evidence tag:

1. **What produced the error?** The report: `ENOTEMPTY` on `/tmp/squeal-1001/tmp/<hash>/cezar-e2e-new-task-<rand>` during a slow file's setup, 1 run in 18, four worktrees running within minutes. Reproduce the class on installed 0.1.199 or the checkout: two daemons (or lanes) whose runs share `/tmp/squeal-<uid>/tmp/<worktree hash>`; a test that creates and removes a temp directory in setup while a sibling run writes under it. Is the collision between worktrees, between lanes of one daemon, or inside one test file's own cleanup? Who owns `<hash>`: the worktree, the daemon, or the run?
2. **How is the error reported today?** The exact `why` output and the known-failures line for such a failure; where in `src/` the setup error becomes a check result (the recorder of file-level errors, `RunReport.fileErrors`, 011 C14), and whether anything already distinguishes an error whose path is under Squeal's tmp root.
3. **Frequency and cost.** In the stores you can read on this host (`<git-common-dir>/squeal/store.sqlite` of this repository's worktrees; read only), how many recorded failures name a path under `/tmp/squeal-`? Over how many runs?
4. **Which rule would the evidence support?** Not a design: list what a "retry once when the error names the owned tmp root" rule would catch and what it would mask, from the cases you saw.

Own only `research/issue-20-reproduction.md` here and throwaway probes under `research/probes/issue-20/`. Edit no board, spec, status or product file. Done when the findings file answers the four questions with tags (`verified by experiment`, `read in source code`, `read in official docs`, `inferred`), the probe is retained and re-runnable, and the limits are stated. Commit when done. Budget: about an hour of wall time; stop and write what you have when it runs out.
