# Coverage records in shared results (row 018-35, issue #190)

Researcher, 2026-11-11. Squeal source read at `f6472ac46` (0.1.440). Data: squawk merge-group runs 43089887527 (main commit `5b278bdc`) and 43088330004 (`67ae4684`, its parent), both Squeal 0.1.431 with the coverage provider on; two `squeal code --base` reports a squawk session wrote on 2026-11-11 (`/tmp/cq-w7.json`, `/tmp/cq-w8.json`). Probes: `probes/coverage-records/`.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | Size | Records are large: 42 MiB deflated one by one for 1,523 files. Deduplicated, the export grows from 1.61 MiB to 7.38 MiB (gzip). A split form gives 3.68 MiB. A separate records file is 0.9 to 1.2 MiB with brotli or zstd 19, and 5.8 MiB with gzip. |
| 2 | Validity at import | A record stays valid at a D11 key, and the gate finds it through its existing lookup if the import writes it as the gate's keeper does. There are two exceptions: the local `coverage.children` marker, and the provider version, which D10's tolerance hides. |
| 3 | The saving | The gate's collection is real: 661 s for 755 files. But imported main-commit records can serve none of it. In both reports, 0 of 674 selected files could have a key equal to a main commit's key. |
| 4 | Trust | The bound is the same as for results (push access). A forged record can turn a CRAP violation into a pass, but only at content equal to the export commit. |
| 5 | Recommendation | Do not carry records in exports. Records in a main commit's export cannot reach the files the gate selects. |

## Findings

### 1. Size

All figures are from run 43089887527 (`5b278bdc`), measured by `sizes.mjs`. Each is **verified by experiment**.

- **Parts.** 4 parts hold 1,690 files, each with a record. The export takes 1,523 of them. Each part's JSON is 10.2 to 10.9 MiB, of which 7.7 to 8.2 MiB is its coverage section. Each part's artifact zip is about 3.3 MB.
- **One record per exported file.**
  - Sources per record: median 103, p95 537.
  - Raw JSON per record: median 34.5 KiB, p95 195.7 KiB, max 255.9 KiB, total 115.3 MiB.
  - Deflated alone, as `encodeRecord` stores one: median 12.7 KiB, p95 69.9 KiB, total 42.3 MiB.
- **Deduplication.** The 1,523 records reference 298,146 source entries. Only 16,972 of them are distinct, over 2,956 paths. As raw JSON, the distinct entries take 20.2 MiB. Function spans and hits are 14.2 MiB (70%) of that. Entries for one path differ only in their hits.

| Form | Export size, gzip (today 1.61 MiB) | Fetched per start point |
|---|---|---|
| Records inline per file | 43.88 MiB (27.2×) | 43.9 MiB |
| One deduplicated source table in the export | 7.38 MiB (4.6×) | 7.4 MiB |
| Split table: per (path, blob) the lines and spans once (6,983 shapes), per entry only the covered-lines and function-hit bits | 3.68 MiB (2.3×) | 3.7 MiB |
| Separate records file (deduplicated table), fetched only when the gate runs | gzip 5.77 / gzip -9 5.70 / zstd 3 1.79 / brotli q5 1.17 / brotli q9 0.99 / zstd 19 0.94 MiB | 1.61 MiB, plus the records file when the gate runs |
| Separate file in split form | gzip 2.07 / brotli q9 0.92 MiB | as above |
| Records of exported files only, against all 1,690 part files | 5.77 against 6.44 MiB gzip (−10%) | — |

**Across commits.** 95.9% of the next commit's distinct entries (81.5% of their bytes) are already in its parent's records. Only 637 of 1,523 whole records are byte-equal. A content-addressed form, such as one git blob per entry, could send only the new 4%. That needs the client to offer the earlier ref's objects during the fetch. D14 writes no local ref, so as written it cannot (**inferred**).

**Retention.** With `--keep 100`, today's refs hold about 161 MiB. A brotli records file adds about 100 MiB. A gzip table adds about 580 MiB (**inferred** from the sizes above).

The compressor times are not findings. The one-minute load was 38.7 on 24 CPUs.

### 2. Validity at import

The following was **read in source code** at `f6472ac46`.

**What a stored record depends on.**
- The result key: the environment hash, the closure blobs and `keyParts`. For Vitest, the environment holds the `coverage` config field as `coverageMarker(children)`, which carries the provider name, `COVERAGE_PROVIDER_VERSION` and `children` (`src/runners/vitest/environment.ts:106-135`, `src/core/code/coverage/record.ts:41`).
- The code store's `provider_version` column. Both the gate and the keeper fill it with `COVERAGE_RECORD_VERSION` (`src/core/code/gate/stored.ts`, `evidenceAt`; `src/core/code/gate/keep.ts:233`).
- Each source's blob. The gate reads a source only when its blob equals the blob in the worktree (`src/core/code/gate/evaluate.ts:56-72`, `standing`).

**Re-keying (D11).** `rekeyFiles` (`src/core/store/transfer-rekey.ts`) changes two things:
- It keys over this worktree's closure, which must hold every exported path, at the export commit's blobs.
- It uses this worktree's environment hash when `importDifferences` finds the two environments equal. `importDifferences` drops `watch` and `coverage` from the comparison (`CI_FIELDS`, `src/core/keys/environment-descriptor.ts:220`).

At the new key, every input of the CI run has equal content. So the record stays true, with three caveats:
- Paths that are in the local closure but not in the CI run read as loaded with no source. That gives no coverage (`evaluate.ts:72`), so it can only lower coverage, never give a false pass.
- A source outside the key is guarded by its own blob check.
- Run-to-run variation is small. All 31 files at an equal exported key in both runs had byte-equal records. Of 344,839 source entries at an equal (test file, path, blob), 99.57% had equal hits (`stability.mjs`, **verified by experiment**).

**Two cases where a re-keyed record would be wrong.** In both, the cause is that D10 tolerates the whole `coverage` field:
1. **Local `coverage.children: true`.** The re-keyed key carries the children marker, but CI's record measured no child process (020 D13.1). The parts path refuses records in this case (`gate/parts.ts`, `options.children`). The store path has no such check, because daemon-made records at such a key include children. The effect is lower coverage only (020 D12.4), but the report would call children measured.
2. **Provider version.** It is never compared at import. A record from another provider version would be stored under the same record version. An import must check the part's `providerVersion` and `recordVersion` against its own, as `unusable()` in `gate/parts.ts` does.

**The seam.** The import would write each record as the gate's keeper does: `shareRecord(record, COVERAGE_RECORD_VERSION)`, then `code.coverage.putParts({ resultKey, providerVersion: COVERAGE_RECORD_VERSION }, …)` (`keep.ts:233-243`). The key is the result's re-keyed key, or the exported key when the result is not re-keyed. The gate's `evidenceAt` would then find results and record at the key and mark the file `from: "store"`, with no change to the gate. The writer must hold the worktree's daemon lock, as the keeper does. The D14 reader runs inside the daemon, so it already holds it.

### 3. The local cost it saves

**The "about 10 minutes".** It is **read in** squawk's `.ai/skills/check-code-quality/references/tool.md:408` at `249c8783`: "a local coverage run, which took about 10 minutes at high load on hearsay-tools/cezarion#1772". PR #1772 is from 2026-10-25 and used the earlier collector (`--coverage-timeout`). It does not measure `squeal code --base`.

**Gate reports (read).**
- `cq-w7`: Squeal 0.1.433, base `67ae4684`, 14 changed paths. Vitest selected 755 files and ran all of them, with none from the store. The run took **661.3 s** (estimate 693 s at width 14; budget 1,800 s).
- `cq-w8`: Squeal 0.1.438, base `5b278bdc`, the same changed content (`run-states.ts` at blob `f6185382` in both). It took 681 files from the store and ran 74, in **136.1 s**.

**Squawk handoffs (read), 2026-11-10/11.** Gates timed out at 600 s three times:
- 718 files at load 58.
- 985 of 1,510 files finished.
- 1,172 of 1,331 files unfinished.

**Share of the gate's time.** Not determined. A report gives the run's `durationMs` but no total, so the shares of selection, counting and keying cannot be read from it.

**What records in main exports would save: 0 files** (**verified by experiment**, `gate-overlap.mjs`).
- Of the 755 selected files, 674 are in the export of the base commit.
- Every one of them has an exported closure that holds a changed path whose worktree blob differs from the export commit's blob. This holds in both reports.
- The cause is the gate's design. Selection is "the test files whose import closure loads" a changed path (020 D3.1), and that path is in the key. So a selected file's key always holds content that no main commit has.
- **Exceptions:** a `--test` file that loads no changed path, and a change whose content main already has.
- So the 681 store hits in `cq-w8` came from local runs at the branch's content: the gate's own kept results (D17.3) or the daemon. That they did not come from an import is verified. Which local writer made them is **inferred**.

The routes that do cut this time are local results at the branch's content (661 s down to 136 s here) and the PR's own CI parts (`--parts`, 020 D13.2; the trial dispatch passed in 33 s, `status.md` 2026-11-11). Main exports do not.

### 4. Trust and principle 5

The following is **read in source code** and **inferred**.

**The bound.** It is the same as for results (D16): anyone with push access writes `refs/squeal/*`. Records would travel the same path: shard part, artifact, then the export job.

**What a forged record could do.** It could claim every line and function hit. `crapScore` returns the complexity itself at full coverage (`src/core/code/crap/score.ts:10-14`). So every function at complexity ≤ 20 under squawk's policy (complexity 20, CRAP 30) would pass the CRAP check.

**What bounds it.**
- The local daemon computes the key.
- Each source's blob must equal the worktree's blob.
- Nothing checks whether the hits are plausible.

A forged pass outcome has the same reach today (D6). By Q3, a forged record would also reach almost no gate-selected file.

**Principle 5.** Carrying CI's records keeps CI as the source of truth: its runner produced them. It adds no gate in CI.

## Recommendation for Squeal

**Carry records in neither the export nor a separate ref.** The issue's premise does not hold for the gate: a file the gate selects always loads changed content, so its key never equals a main commit's key. In both real squawk reports, 0 of 674 selected files could have used an imported record.

The cost would be:
- 4.6× the export (7.4 MiB per start point) inline, or
- 2.3× (3.7 MiB) in the split form, or
- a separate ref of about 1 MiB per commit with brotli or zstd 19 (5.8 MiB with gzip), plus about 100 MiB at `--keep 100`.

The issue's goal, a local gate under 5 minutes, depends on these instead:
- results kept at the branch's content (`cq-w8`: 755 files in 136 s, 681 from the store);
- the PR's own parts (020 D13.2);
- D17's estimate and order.

If the coordinator still wants records for imported files, for example for the daemon's own CRAP views of unchanged files, these facts apply:
- The form is a separate ref in split form with brotli, 0.92 MiB here.
- The import must refuse records when the local marker has `children`, and must compare provider and record versions explicitly (Q2).
- The store write needs no gate change.

## Open questions

1. Does any reader besides the gate need coverage of imported files? The daemon's CRAP views under `lookup-only` are a candidate. If none does, #190 can close with this finding.
2. Should #190's goal move to 020 as "gate time from local and PR evidence" (D13.2, D17)? That is a coordinator call.
3. The cross-commit reuse (96%) only pays off with a fetch that offers the last fetched ref's objects. That needs D14 to keep a local ref, which it rules out today.

## Sources

- Spec 018 D2, D3, D6, D10, D11, D13, D14, D16; spec 020 D3, D11.7, D12, D13, D17; `../status.md` (2026-11-11 entries).
- Squeal at `f6472ac46`:
  - `src/core/ci/parts.ts`, `src/runners/vitest/ci-coverage.ts`
  - `src/core/code/gate/{stored,parts,keep,evaluate}.ts`
  - `src/core/code/coverage/{record,parts}.ts`, `src/core/code/store/schema.ts`
  - `src/core/store/transfer-rekey.ts`, `src/core/keys/environment-descriptor.ts`, `src/runners/vitest/environment.ts`, `src/core/code/crap/score.ts`
- `hearsay-tools/squawk` Actions runs 43089887527 and 43088330004: artifacts `squeal-parts-shard-1..4` and `squeal-results`, downloaded read-only on 2026-11-11.
- squawk at `249c8783`: `.ai/skills/check-code-quality/references/tool.md:408`, `references/pre-pr.md`; PR #1772 (2026-10-25); task handoffs under `.ai/cezar/runs/` (01fa4534, 13bd9249, bf4296e5, 26864d25).
- Gate reports `/tmp/cq-w7.json` (2026-11-11 20:06Z) and `/tmp/cq-w8.json` (22:24Z), written by a squawk session.
