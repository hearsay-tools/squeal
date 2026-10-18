# 004-72 design draft: rank likely-affected slow files first (gh-4)

Status: draft by the coordinator, 2026-10-18, for the human's acceptance. Source: issue #4, `../../research/issue-4-ranking.md`, `../../research/issue-4-signals.md` (signal b2). The human gave the go for a design on b2 (round 6).

## Proposed D-text (a D5 amendment, slow-tier order)

Amended 2026-10-18 (the human, gh-4, row 004-72): within a slow tier's class, after C15's promoted files and the runner's `direct` importers, slow files are ordered by **evidence**: tokens taken from each file the revision changed and its local imports (`./` and `../` specifiers the closure already holds), matched whole against each slow file and its own local helpers. A token is a `data-*` attribute value, an `aria-label`, or a hyphenated class name; one that more than 20 slow files match is dropped. A file's evidence is how many kept tokens it matches; more evidence runs first, then today's order (shortest last-known duration). Ranking only reorders: every slow file the revision invalidated still runs, none is skipped or deferred, and a file with no evidence keeps its place behind those with some. The slow-tier line and `status` say nothing about evidence; `why <slow file>` names the tokens that ranked it.

Cost and storage: one token set per slow file, keyed by the hashes of the file and its helpers, kept in the store and rebuilt when a hash changes; the changed side is read once per revision. The probe measured 7 to 35 ms per edit with the slow side cached, 40 to 89 ms cold.

## The decision: default on, or opt-in

1. **Opt-in (recommended):** `slow.rank: "tokens"` (default `"duration"`, today's order). The signal is a DOM and browser-test heuristic; a repository whose slow suites are not browser tests gains nothing and pays the token pass. `squeal setup` asks once when a slow glob matches Playwright or browser specs.
2. **Default on:** every repository with a slow tier gets the pass; repositories with no tokens see no change in order, at the measured cost per edit.

Both leave room for a later maintainer hint key (signal c, a glob-to-specs map in policy), which the research found exact where written and blind elsewhere; this draft does not add it.

## Done when (the code row that follows)

#1076's replay ranks its spec first of 76 (E1 in `issue-4-signals.md`), E5's specs in the top 4, a build-script edit changes no order, every invalidated slow file still runs; the token set is rebuilt on a helper's hash change; `why` names the tokens; the cost per edit is measured on cezarion at three loads.
