# Research brief 011-395: throughput and ordering when one edit queues over a thousand affected files

Use /researcher. Shape: research. Outcome: where the time goes, with shares, when one shared-module edit queues 1,200 to 1,600 affected test files, and what a gate could know about it up front.

## Why

The human made this priority 2 of 5 on 2026-11-19: research first, design after. Squeal will not tell an agent to hand its verdict to CI; that is a project's own policy (the human, 2026-11-19). Evidence: [#245](https://github.com/hearsay-tools/squeal/issues/245) and its three comments of 2026-11-18/19 (4 Squawk tasks on 0.1.563: about 1,000 files without a result after an hour at load 11 to 29 on 24 CPUs; once 2 to 3 hours that never emptied), [#216](https://github.com/hearsay-tools/squeal/issues/216), [#209](https://github.com/hearsay-tools/squeal/issues/209) (edited files wait behind the queue), [#225](https://github.com/hearsay-tools/squeal/issues/225) (CPU admission while slots are free), [#125](https://github.com/hearsay-tools/squeal/issues/125), [#139](https://github.com/hearsay-tools/squeal/issues/139), [#224](https://github.com/hearsay-tools/squeal/issues/224).

## Read first

`docs/vision.md`; triage findings `research/issue-245.md`, `issue-209.md`, `issue-225.md`, `issue-216.md`; `research/edit-load.md` and `019-run-triggers/research/load-split.md` for method; spec 011 C4 and C10 (capacity), 021-18 (75% of CPUs ceiling). Fixes must suit users' machines, not this host.

## Where to run

On the lab VM in the shared notes (`~/projects/notes/topics/`, the VM topic): read that note first, check its load and state it, work under `~/work/011-395/`, delete it and leave no process at the end. Install Squeal 0.1.563 there. Use a `git bundle` of a large repository from this host whose shared-module edit selects over 1,000 files; never copy credentials. Nothing heavy on this host. Tell peers through Cezar peer messages before a long run there.

## Questions

1. Files per minute on a quiet 12-vCPU VM for such an edit, compared with the same files run by plain `vitest run`: what share is Squeal overhead (admission, listing, heartbeat, store writes, re-queue on a new revision)?
2. With a second edit mid-queue, how much finished work is discarded or re-run, and do edited and named files run first?
3. At the start, how well can Squeal estimate the time to clear the queue from stored durations? Give error against the measured time.

## Rules

Tag each finding. No design, no product code. Own `research/broad-change-throughput.md` and `research/probes/broad-change-throughput/` only. Budget about three hours. Done when questions 1 to 3 have numbers and tags and the probe README says how to re-run it. Commit.
