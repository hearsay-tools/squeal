# Probe: defect causes (016-09)

Throwaway. These scripts read this repository's docs and the GitHub issue list, and write nothing outside stdout. They start no daemon, harness or test run.

- `extract.mjs <repo-root>`: every review file under `docs/specifications/*/reviews/`, its verdict and its blocker and should-fix items.
- `rows.mjs <repo-root>`: every board row in `docs/board.md` and 001's `board-archive.md`, with its section and a first guess at its origin.
- `items.mjs <repo-root> <reviews.jsonl> <rows.jsonl> <issues.json>`: one item list. FAIL-review items, escaped-defect rows, the board's Later list, and GitHub issues no row names.
- `classes.tsv`: the researcher's reading. One primary class per item, an optional secondary, and a reason for A and B. This file is the judgement; the scripts only count it.
- `tally.mjs`, `cost.mjs`, `location.mjs`: counts, cost and a cross-check by cited path. Their output at `f6320cd7e` is in `*-output.txt`.

Rerun, from this directory:

```sh
node extract.mjs ../../../../../.. > /tmp/dc-reviews.jsonl
node rows.mjs ../../../../../.. > /tmp/dc-rows.jsonl
node rows2.mjs /tmp/dc-rows.jsonl > /tmp/dc-rows2.jsonl
gh issue list --state all --limit 1000 --json number,title,state,createdAt,labels,body > /tmp/dc-issues.json
node items.mjs ../../../../../.. /tmp/dc-reviews.jsonl /tmp/dc-rows2.jsonl /tmp/dc-issues.json > /tmp/dc-items.jsonl
node tally.mjs /tmp/dc-items.jsonl classes.tsv
node cost.mjs /tmp/dc-reviews.jsonl /tmp/dc-items.jsonl classes.tsv /tmp/dc-rows2.jsonl
node location.mjs /tmp/dc-items.jsonl classes.tsv
```

`rows2.mjs` drops `origin: feature` rows and sets `kind`: `process-row` when the title names a review, research, survey, proof, probe, measure, release, eval or design; `review-repair-row` when it names a repair, a fix of, B<n> or S<n>; otherwise `defect-row`.

Item ids depend on file order at `f6320cd7e`. A later board or review changes them, so `classes.tsv` matches only that commit.
