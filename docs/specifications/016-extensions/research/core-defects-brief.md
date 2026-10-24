# Research brief 016-11: what repeats in core-logic defects

Use /researcher. Shape: survey. Outcome: where in the core most of our defects come from, which causes repeat, and what kind of change would have caught or prevented each repeating group, so that the human can see the largest source of issues. Follow the rules in `README.md`.

Read first: `defect-causes.md` (method, class E, limits); its data in `probes/defect-causes/` (`classes.tsv`, the item scripts); `runner-kit.md` recommendation 1 and open question 1; 011's `spec.md` section titles, to name areas.

Items: the 415 defects 016-09 put in class E (core logic), and the 10 marked E/B. Reuse its item list and its excerpts, and read the cited review or row in full where the excerpt is too short.

Questions:

1. **Area.** Sort every E item into one core area, using 011's sections where they fit: watcher and revisions, keys and closures, scheduler and validity, state and transitions, delivery views and wording, status and `status --wait`, the store, daemon lifecycle and handover, the slow tier, policy and capacity, focus and named demand, `squeal setup` and the CLI, code checks (015). Counts per area, per spec and over time.
2. **Mechanism.** Within each area, the repeating cause, for example an unhandled state or order, a race at a boundary, a count or a sum, a text that says more than it knows, a rule implemented in two places, a restart or a second worktree, a missed input. Name each group that holds three or more items, with its items.
3. **Catch.** For each group of three or more, what would have caught it before review: a scenario through a scratch daemon (016-10 open question 1), a property or state-machine test, a single owner for a rule, a type, a check in the spec, or nothing found. Name a past test that already does it, if any.
4. **Cost.** FAIL rounds and repair rows per group, and the five costliest groups.
5. **Check.** Re-read a random 10% of the E items, chosen with a fixed seed, without looking at your first answer. Report how many got the same area and mechanism.

Tag each classification `inferred` with the evidence read. Own `core-defects.md` and `probes/core-defects/`.
