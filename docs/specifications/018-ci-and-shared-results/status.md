# 018 CI and shared results: status

Stage: research (2026-10-31; no spec yet, no build authorized)
Started: 2026-10-31

## Decisions so far

- 2026-10-31, the human, three ideas to research: whether Squeal can run tests in CI; whether a local Squeal could import CI results, so that what merges to main is shared with team members; whether a remote store could be an option. "Not sure if any of this makes sense, but would be curious to see what comes out of it."
- 2026-10-31, the coordinator (e3814b62): wave 0 is three researchers in parallel, one per topic in `research/README.md` (`ci-run`, `result-import`, `remote-store`), on the standing researcher model. The question the three share is whether a key computed on one machine equals the key another machine computes for the same content; `result-import` owns that measurement. The spec, if any, is written from their findings, for the human's review.
- 2026-10-31, the coordinator: wave 0 landed. The three findings agree. Squeal as a CI runner or test selector: no (`ci-run.md`). Importing CI results: sound in principle, since the local daemon recomputes every key, but no CI key matches a developer key in this repository today, because of the Node patch version and `CI=true` (`result-import.md`). A remote store: no; the smallest form is one bundle per main commit on a git ref in the team's repository, written only by CI on main, imported in bulk (`remote-store.md`). Next: the human decides whether to continue to a spec; no row is authorized.

## Open questions

- Does any of the three fit vision principle 5 ("Squeal does not replace ... CI")?
- Are content keys portable across machines today, and if not, at what cost could they be?
