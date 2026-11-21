# Wave 22: research on CI imports after a fast-forward (gh-261)

The human, 2026-11-21, on [#261](https://github.com/hearsay-tools/squeal/issues/261): research first, with a narrower idea than the triage proposal. CI results are imported on daemon start (D14). The human expects that a pull brings the new main commit's CI results with it, so Squeal could check whether the new HEAD has newer CI results and import them, which may close most of the gap. Lab VM allowed for reproduction and experiments.

## 018-69 research: does the new HEAD's CI export reach the store before a fast-forward queues its misses

Shape: research. Use /researcher. Read `research/README.md` (rules), spec D13–D16, `research/transport.md`, `src/core/shared/reader.ts` and its callers, then `011-core/research/issue-261.md` and `issue-204.md` (triage evidence).

Answer, with each finding marked as the README requires:

1. Does `git pull` / `fetch` bring `refs/squeal/<sha>` exports, or only the reader's own fetch? Correct the premise if wrong.
2. After `git merge --ff-only origin/main` in a worktree with a running daemon, does the reader import the new HEAD's export, and when: before or after the revision queues changed-key misses? Do imported results then take queued files off the queue, or do they run anyway?
3. How often does an export exist for the new HEAD at pull time (CI latency, merge-queue SHAs, pruning `--keep`, D14's one-export-per-start-point rule with no gap filling)? Use the reporting project's real refs read-only (cezarion; check its `shared.ref` setup).
4. Of the files a fast-forward queues, what share would a matching-key import cover (environment, D10/D11, coverage, lint)? Measure on a real fast-forward.
5. The gap that remains, and the smallest changes that would close it (for example a short bounded wait for the import before queueing, import on every HEAD move, fall back to the nearest older export). Name the risk to current-state honesty for each. Do not design.

Experiments: on the lab VM as the human allowed (`~/projects/notes/topics/apptension-lab-vm.md`; its timings are not quiet-host numbers), or boat.dev for isolation (`topics/boat-dev.md`). On this host only small, read-only probes. No pushes, no workflow runs. Own HOME isolation for anything that starts agents.

Owns `research/issue-261-ci-import.md` and `research/probes/issue-261/`. Done when the findings file answers 1–5 with numbers from a real fast-forward and is committed.
