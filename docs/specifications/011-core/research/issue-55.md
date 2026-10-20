# Issue 55: file-level `squeal why` is slow

Bounded reproduction (brief: `research/issue-55-brief.md`), 2026-10-20, 17:55 to 18:13 CEST. Squeal 0.1.229 (installed plugin `~/.claude/plugins/cache/hearsay/squeal/0.1.229`, source at `eb01536f`). Host: 24 CPUs. Nothing implemented. No real store was opened, and no suite was run.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Is file-level `squeal why` CPU-bound on a store with about 10 checks of 35 results each? | Yes, but the file's 10×35 size doesn't drive it. The time grows with the number of known states in the **worktree**, roughly quadratically: 0.25 s at 1,000, 29 s at 20,000. user ≈ real, so the time is CPU in the CLI. | verified by experiment, 0.1.229 |
| 2 | Where does the time go? | 85% of CPU goes to the dedup in `resolve()`, `src/core/status/why.ts:90`: `.filter((check, i, all) => all.findIndex((c) => sameCheck(c, check)) === i)`. That is O(n²) `sameCheck` calls, and each one builds two `checkIdentity` strings. | verified by experiment (CPU profile), 0.1.229 |
| 3 | Likely seam | `resolve()` in `why.ts`. Dedup with a `Set`/`Map` keyed by `checkIdentity`, making it linear. A query that `namesFile` matches could also filter to that file's checks before formatting every check. The issue's guesses (history aggregation, duration statistics, result listing) are ≤ 2% of the profile. | inferred from source and profile |

## Findings

**Path.** `squeal why <test file>` never names a check exactly, so `readWhy` (`why.ts:65`) falls through to `resolve(store, worktreeId, query)` (`why.ts:85`). `resolve` reads **every** known state of the worktree, plus `held()` (one `results.byKey` per test-file key). It deduplicates that list with `findIndex`, which scans from the start for each element, so n unique checks cost about n²/2 `sameCheck` calls. Only then does it filter names by `includes(query)`. The 10 matches come back as `found: false` with candidates, and the CLI exits 1. A query that names a check exactly takes `known()` → `report()` and never enters `resolve`. Tag: read in source code, `why.ts` at `eb01536f`, matching the 0.1.229 bundle (`dist/cli/squeal.mjs:48936-48940`).

**Synthetic reproduction.** `probes/issue-55/seed.mjs` builds a throwaway git repo under `/tmp` with a schema-V1 store. It seeds one target file `src/target.test.ts` with 10 checks × 35 results, plus *n* other checks of the same worktree spread over 763 other test files (cezarion's tracked `*.test.ts(x)` count) with one result each. `probes/issue-55/run.sh` times `squeal why src/target.test.ts` per size, skips any size whose one-minute load is above 24, and deletes each repo. Command: `docs/specifications/011-core/research/probes/issue-55/run.sh $PWD 5000 20000 1000 10000`. Output (18:10):

| other checks *n* | 1-min load before | real | user | sys |
|---|---|---|---|---|
| 1,000 | 16.83 | 0.25 s | 0.24 s | 0.05 s |
| 5,000 | 22.73 | 2.61 s | 2.51 s | 0.09 s |
| 10,000 | 16.83 | 8.89 s | 8.88 s | 0.05 s |
| 20,000 | 22.73 | 29.25 s | 29.24 s | 0.10 s |

Each doubling costs ×3.3 to ×3.4, the quadratic term on top of linear reads. The target file and its printed output are the same in every row. Tag: verified by experiment.

**Profile.** At *n* = 5,000 (load 23.04), `node --cpu-prof .../dist/cli/squeal.mjs why src/target.test.ts` took 2,938 ms of samples. Self time: 41.4% the `findIndex` filter arrow (`squeal.mjs:48940`, `resolve4`), 35.2% `sameCheck`, 8.7% `checkIdentity`, 5.5% GC, and 1.9% SQLite `all`. Tag: verified by experiment.

**Incident vs. synthetic.** The incident (issue 55, cezarion PR #1330, load about 40 on 24 CPUs): 55.6 s real, 48.7 s user for a file of 9 checks × 34 results. This research didn't measure the incident worktree's known-state count. The closest recorded figure is cezar's main checkout, 19,452 known states (011 C6, row 011-42 amendment). The synthetic 20,000 run took 29 s of CPU at load 22.7. That is the same order as the incident's 48.7 s CPU at load 40, where frequency and cache contention plausibly account for the rest. The real store also carries file-level checks and longer names, which this probe doesn't seed. Tag: inferred.

**Smoke run (protocol note).** An earlier unscripted run at *n* = 1,000 / 100 files measured 0.49 s real. The one-minute load sampled just before it was 24.57, marginally above the gate, so it isn't used as evidence. The first scripted attempts (17:58 to 18:09) were skipped at loads of 26 to 32.75.

## Recommendation for Squeal

Treat issue 55 as a quadratic dedup in `resolve()`, not a store-query problem. The store reads are indexed and small in the profile. The seam is `why.ts:86-91`. Replace the `findIndex` dedup with a single pass over a `Set` of `checkIdentity`. Optionally, when `namesFile(query)` matches a test file of the worktree, take that file's checks (`testFileOf`) before formatting the rest. The issue's second acceptance criterion fits a test that seeds about 20,000 known states plus a 10×35 file and bounds `readWhy` for the file path. In this probe, 20,000 states cost 29 s today. With the 85% dedup share gone, a few seconds or less is expected (inferred, not measured). `squeal failures` and the `status` paths weren't examined for the same pattern. 011 C6's row 011-42 note (each poll decoding every state) is related but separate.

## Open questions

- Known-state count of the incident's worktree (cezarion PR #1330's checkout). Not determined, because the brief forbids opening a real store. A read-only `SELECT COUNT(*) FROM known_states WHERE worktree_id = ?` by the human or the coordinator would settle it.
- Do other `findIndex`-style dedups over all known states exist in `status`/`failures`? Not determined, because that is out of this brief's scope.
- Time after a fix. Not determined, because nothing was implemented.

## Sources

- GitHub issue 55, hearsay-tools/squeal, read via `gh api repos/hearsay-tools/squeal/issues/55` on 2026-10-20 (body above; 0 comments): https://github.com/hearsay-tools/squeal/issues/55
- `src/core/status/why.ts`, `src/core/status/why-rank.ts`, `src/core/state/inherited.ts`, `src/core/state/derive.ts` (`checkIdentity`), `src/core/store/repos/results.ts`, `src/core/store/schema.ts` at `eb01536f`
- Bundle `~/.claude/plugins/cache/hearsay/squeal/0.1.229/dist/cli/squeal.mjs:48936-48940`
- `docs/specifications/011-core/spec.md` C6 (row 011-42 amendment: 19,452 known states)
- Probes: `probes/issue-55/seed.mjs`, `probes/issue-55/run.sh`, `probes/issue-55/README.md` (throwaway; generated repos removed)
