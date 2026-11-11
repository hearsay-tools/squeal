# Probes for `coverage-records.md` (throwaway)

These scripts are throwaway. They read downloaded CI artifacts and gate reports and print numbers. They write nothing, start no daemon and run no test.

- `sizes.mjs <run dir> [<second run dir>]`: record sizes per test file, the export's size with records in several forms and compressors, and the share of source entries two consecutive commits have in common. A run dir is the output of `gh run download <run> -R hearsay-tools/squawk` (`squeal-parts-shard-*` and `squeal-results`). Its compressor times were taken at a one-minute load of 38.7 on 24 CPUs and are not findings.
- `stability.mjs <run dir A> <run dir B>`: whether two runs give equal records at an equal exported key, and per source at an equal blob.
- `gate-overlap.mjs <gate report> <export .json.gz> <ls-tree file>`: for a `squeal code --base` report, how many selected test files have an exported closure without a changed path, so that an imported key could equal the gate's key. The ls-tree file is `git ls-tree -r <export commit>`.

Inputs used (2026-11-11): runs 43089887527 (main commit 5b278bdc) and 43088330004 (67ae4684) of `hearsay-tools/squawk`; gate reports `/tmp/cq-w7.json` and `/tmp/cq-w8.json` written by a squawk session that day. None of them is committed.
