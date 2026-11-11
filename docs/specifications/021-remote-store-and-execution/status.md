# 021 Remote store and remote execution: status

Stage: research.
Started: 2026-11-11

## Decisions so far

- 2026-11-11, the human, two topics to research: "remote store (alternative way to share results and potentially introduce a more performant store than SQLite for the remote path)" and "remote test execution (including potentially using mutagen or similar solution to handle code sync) via SSH to a remote host at first, potentially followed up with something like boat.dev to spin up VMs / containers on demand".
- 2026-11-11, the coordinator (52f4f62a): a new spec, not an amendment of 018 or 019. Both topics were researched before and both answered "not now": `../018-ci-and-shared-results/research/remote-store.md` (2026-10-31: no store service; a results bundle per main commit on a git ref, which shipped as 018's second slice) and `../019-run-triggers/research/remote-runner.md` (2026-11-03: no remote runner now; the smallest form is the slow tier of one runner on one host). Wave 0 is two researchers in parallel, one per topic in `research/README.md` (`store-service`, `remote-execution`), on the standing researcher model. Each extends the earlier file and answers what is new: a live store and its engine; Mutagen over SSH, and machines started on demand.
