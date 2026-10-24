# Probe: core defects (016-11)

Throwaway. These scripts read 016-09's item list and this directory's codes, and write nothing outside stdout. They start no daemon, harness or test run.

- `areas.tsv`: the researcher's reading. One area and one mechanism for each of 016-09's 455 class E items (415 after residuals). This file is the judgement; the scripts only count it.
- `catch.tsv`: the researcher's reading. For each area and mechanism group of three or more, the kind of check that would have caught it, and a past test or row that already does it.
- `reread.tsv`: the blind re-read of the 42 items `sample.mjs` picks (seed 16011), coded again before comparing with `areas.tsv`.
- `eitems.mjs`: prints the E items with an excerpt, for reading.
- `sample.mjs`: picks 10% of the deduplicated E items with a fixed seed; `sample.txt` is its output.
- `tally.mjs`: counts per area, spec and period; every group of three or more with its items and cost. Output in `tally-output.txt`.
- `threads.mjs`: cost per feature thread (the thread lists are in the script). Output in `threads-output.txt`.
- `catch.mjs`: items and blockers per kind of catch. Output in `catch-output.txt`.
- `family-output.txt`: review blockers and FAIL rounds per mechanism family (a one-off `node -e` over `areas.tsv`; the family map is in `core-defects.md`, finding 2).

Rerun. 016-09's item ids hold only at `f6320cd7e`, so build its item list from a checkout of that commit:

```sh
git worktree add --detach /tmp/cd11/wt f6320cd7e
D=../defect-causes
node $D/extract.mjs /tmp/cd11/wt > /tmp/cd11/reviews.jsonl
node $D/rows.mjs /tmp/cd11/wt > /tmp/cd11/rows.jsonl
node $D/rows2.mjs /tmp/cd11/rows.jsonl > /tmp/cd11/rows2.jsonl
gh issue list --repo hearsay-tools/squeal --state all --limit 1000 --json number,title,state,createdAt,labels,body > /tmp/cd11/issues.json
node $D/items.mjs /tmp/cd11/wt /tmp/cd11/reviews.jsonl /tmp/cd11/rows2.jsonl /tmp/cd11/issues.json > /tmp/cd11/items.jsonl
node $D/tally.mjs /tmp/cd11/items.jsonl $D/classes.tsv | diff - $D/tally-output.txt   # no output: same items as 016-09
node tally.mjs /tmp/cd11/items.jsonl /tmp/cd11/reviews.jsonl /tmp/cd11/rows2.jsonl areas.tsv
node threads.mjs /tmp/cd11/items.jsonl /tmp/cd11/rows2.jsonl
node catch.mjs areas.tsv catch.tsv /tmp/cd11/items.jsonl
git worktree remove /tmp/cd11/wt
```

On 2026-10-25 the `diff` printed nothing: the 858 items and their counts match 016-09's.
