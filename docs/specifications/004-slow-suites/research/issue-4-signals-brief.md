# Research brief: issue 4, which signal ranks the slow files an edit likely affects

Use /researcher. Shape: research, read-only on the product. Decided by the human on 2026-10-17 (triage row gh-4, "research then design"): before any design, compare the three candidate signals on real data. Run only when the one-minute load is below the CPU count.

Read first: [issue #4](https://github.com/hearsay-tools/squeal/issues/4) and its comments; `issue-4-ranking.md` and its probe under `probes/issue-4-ranking/` (the stored durations, the CI file lines, the diff tokens it collected); 011 C4 step 4 (today's order: class, then shortest duration first) and C15 (named demand: a wait on a listed test file promotes it; source paths are not promoted); 004 D2, D5, D8.

Questions, each with its evidence tag:

1. **Closure coverage.** For the probe's edit (a Markdown change that put the relevant spec 66th of 77), and for three more edits you pick from cezarion's recent history (a source file a few specs import; a shared helper; a config file), which slow files does each candidate signal rank first, and where does the file the author would have wanted land? Signals: (a) the stored closure, where the edited path is in it at all; (b) diff tokens (identifiers in the diff matched against the slow files' sources, the probe's method); (c) a config hint (a per-glob `inputs` ranking the project declares). Use the probe's data and the store you can read; no product change.
2. **Cost.** What each signal costs at plan time (ms per edit for 77 slow files; the closure is free, tokens need the diff and a scan, a hint needs nothing) and what it needs stored.
3. **Interaction with C15.** With named-demand promotion shipped (011-11), does a named wait on the relevant slow spec already cover the issue's case? What does an agent have to know to use it, and when would ranking still help (the agent does not know which spec is relevant)?
4. **Safety.** Which signal can rank a stale file so late that the tier's duration bound leaves it out of the first slow tier, and how D5's "every stale file still runs" holds under each.

Own only `research/issue-4-signals.md` here and throwaway probes under `research/probes/issue-4-signals/`; the existing probe stays as it is. Edit no board, spec, status or product file. Done when the findings file answers the four questions with tags (`verified by experiment`, `read in source code`, `read in official docs`, `inferred`), names the signal the evidence favours with its numbers, and states the limits. Commit when done. Budget: about ninety minutes of wall time; stop and write what you have when it runs out.
