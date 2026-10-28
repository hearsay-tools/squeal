# Round 3: keep coverage opt-in

**Recommendation [inferred]: keep coverage opt-in.** The available reading finds one clear useful case, remaining noise and missing records. It does not establish the CPU goal or seven-day retention. This finishes the bounded reading, not the spec or a default-change decision.

Window: **2026-10-27 08:23:46 to 2026-10-28 06:31:05 UTC**, 22 h 7 min 19 s. Worker `05fecde6`, against the final brief. Parent `a52cf0ea` and this worker are excluded from sessions and run/record counts. Both had zero validation runs when read. The probes made no product, config, plugin or live-store write, CPU experiment, test-suite run or independent session. The harness still registered these reader worktrees and counted their files.

## Population and version limits

**[Verified by experiment: transcript extraction, runtime paths 0.1.366–368.]** There are **55 worktree sessions**, with **340 actual Squeal deliveries**. **10 sessions wrote measured `src/` files: five Claude Code, five Codex.** Three of those ten received coverage lines. All ten useful lines went to one of the ten. Another two sessions received coverage lines on integrated code or a research probe. Main-checkout helpers are separate: 222 sessions, 226 deliveries, zero source-edit sessions and zero coverage lines.

| Worktree harness | Delivery version population | Sessions | Deliveries | Measured source-edit sessions |
| --- | --- | ---: | ---: | ---: |
| Claude Code | 0.1.366 | 7 | 77 | 4 |
| Claude Code | 0.1.366 then 0.1.367 | 2 | 41 | 1, edits under 0.1.366 |
| Codex | 0.1.366 | 9 | 35 | 0 |
| Codex | 0.1.366 then 0.1.367 | 2 | 53 | 0 |
| Codex | 0.1.367 | 18 | 97 | 4 |
| Codex | 0.1.367 then 0.1.368 | 1 | 14 | 0 |
| Codex | 0.1.368 | 8 | 23 | 0 |
| Codex | no Squeal delivery/version observed | 8 | 0 | 1 |

The five Claude source-edit tasks are `2cb095fe`, `dee1b657`, `19fa731c`, `57d984a6`, `cd415cf8`. Codex tasks are `fa8271b1`, `fc862e50`, `e162d99d`, `73d5b680` on observed 0.1.367 paths, and `722776bf` with no observed runtime path. This last session counts as source work, **not proven coverage-on exposure**. Its installed adapter skill names 1.0.2; that is not a runtime version. Main helpers split into 81/111/3/27 sessions at inferred 0.1.366/367/368/369 respectively. There is no measured source-edit population on 0.1.369.

**[Inferred: version attribution.]** Claude versions use the prior readings' cache-birth/latest-process-start rule. They are bounds, not proof of loaded hooks or daemons. Codex versions use only paths in actual Squeal developer messages, carried forward until the next observation. An agent quoting an old path does not change its version. These paths prove what the harness named, not every later runtime loaded. Catalog text mentioning “SQUEAL” is excluded from delivery counts. This corrects the old extractor's broader match; raw interim delivery totals are not directly comparable.

Source-edit counts use explicit write targets, patch headers and recognized shell writes. They exclude cherry-picks, `test/` and `src/runners/node-test/runtime/`. Commands are retained only in private scratch while judging; published evidence contains paths and counts. This is a lower bound: arbitrary shell programs, generated writes and scripts outside `src/` are not a complete edit census. The packager and probe cases below remain in the coverage-line denominator.

## Delivered lines and judgments

**[Verified by experiment: 42 extracted coverage lines in five sessions. Inferred: usefulness judgments after reading actions.]** Round 2's rules give **10 useful, 27 noise, 5 unclear**. These are line counts, not 42 independent observations.

| Observed/inferred hook runtime | Coverage lines | Useful | Noise | Unclear |
| --- | ---: | ---: | ---: | ---: |
| 0.1.366 | 24 | 10 | 10 | 4 |
| 0.1.367 | 6 | 0 | 5 | 1 |
| 0.1.368 | 12 | 0 | 12 | 0 |
| All | 42 | 10 | 27 | 5 |

The bounded cases are in [final-cases.json](data/final-cases.json); every Squeal line and verdict is in [final-judged.json](data/final-judged.json).

- `cd415cf8`: five FAIL lines at 11:26:47 preceded an in-process test write at 11:27:14; five PASS lines at 11:27:29 confirmed it. For example: `FAIL CRAP: fields (src/harness/codex/adapter/index.ts:98): 72, over 30`. All ten are useful. The agent's commit subject was “test(002-29): adapter dispatch and repository test in the test’s thread”. The recovery was quick **because the agent acted**; it is not transient noise.
- `57d984a6`: ten packager lines, six transient noise and four unclear. The agent planned its test at 11:56:28 and wrote it at 11:56:50.064, **before** the FAIL delivery at 11:56:50.866. PASS came at 11:57:08.625. No response to the warnings occurred. Only three matched FAIL/PASS pairs are called transient noise. Unpaired `parseArgs`, `<filter>`, `git` and the untested `packageCodexRuntime` line stay unclear. The agent's plan was “Now the packager test: assets from the exact commit (not the working tree), descriptor bound to the commit, refusals, and upload notes.”
- `a1964cc6`: nine lines after integrating worker code, no action on those warnings, counted as noise. Its later source-map repair followed CI failures, not these lines.
- `e162d99d`: one own-edit `writeError` warning with no visible follow-up, unclear.
- `2ea62b34`: twelve lines on `research/probes/issue-113/probe.ts`, noise by the research-probe rule. These are deliberately untested probe functions. No product mechanism was investigated here.

For scale, Round 2 had 178 coverage lines in 20 of 105 worktree sessions over 22.1 h: 5 useful, 109 noise, 64 unclear. This window has fewer sessions and warnings. The useful evidence remains one case. The different workload and version mixtures do not prove a population-level improvement. There are also 14 complexity lines, kept separate from coverage.

**[Verified by experiment: summaries and loader accounts.]** Worktree sessions got **29 registration summaries: 11 first and 18 repeats**. The 18 repeats are separate noise. They got **4 told-over summaries, zero repeats**, and 84 other first summaries, mainly counting/count-complete messages. Main helpers got 222 first registration summaries. No inconsistent loader count occurred in **12 file/delivery pairs** with a loader account. These are small denominators, not proof that every loader account is correct.

## Records, settlement and saved drops

**[Verified by experiment: read-only store queries, providers 2 and 3.]** The retained store has **10,070 manifests** written inside the window: **8,757 provider 2**, **1,313 provider 3**, zero full records. Their compressed manifest bytes total 21,966,617.

A record's producer is inferred from the latest retained result at its key at or before its write. Only **1,752 records** match a saved daemon start/heartbeat interval, all recorded **0.1.366**. **8,318 have unknown daemon versions**, including all provider-3 records. Of those, 21 have no retained producer result. Shared keys and later replacement prevent exact provenance. Cache-time bounds on interim records remain bounds; they are not promoted to loaded versions. Provider version is stored directly and is independent of runtime version. The current worktree daemon field cannot establish an earlier producer.

The bounded record/result query completed at 2026-10-28T06:36:51.645Z. It is a later read of retained rows, not a historical database snapshot.

**Settlement cutoff: 2026-10-28 06:29:05 UTC**, 120 s before the window end. All **897 retained runs** started in the window had ended `completed` by that cutoff. They scheduled **11,874 test-file slots** and retained **10,592 test-file/result-key rows**. **521 of 10,592 (4.92%) had no record** at the reading; 10,071 had one. None of the missing rows was skip-only; no matching record had a timestamp after the window end. The result query checks both provider populations. Missing rows have no record from which to assign a provider version.

The largest missing-record groups are `fa8271b1` 248, `a1964cc6` 101, `73d5b680` 88 and `13dbcff4` 42; the remaining 42 are spread over nine trees. [final-store-counts.json](data/final-store-counts.json) preserves every group and bounded path examples. Counts describe retained results, not all original payload attempts. Scheduled slots without a retained result are not silently counted as completed test-file results. Causes, deliberate coverage exclusions and user impact are not established. This does not widen proposed row 015-94 into mechanism research.

**[Verified by experiment: saved notes, corrected `notes.%` prefix.]** The final snapshot retained four in-window notes in two trees. Latest totals are **20 `no-result`** in `a1964cc6` and **59 `closed`** in `13dbcff4`; their producing daemon versions are unknown. Combining these with the corrected interim snapshot preserves **20 notes across eight trees**, whose latest per-tree totals establish **at least 158 drops: 95 `no-result`, 63 `closed`**. No saved note in this union reports another cause. This is a lower bound, not the total drop rate. Three-note retention, daemon resets and removed trees lose history. Notes already lost cannot be reconstructed. These eight tree totals are disjoint; cumulative notes within a tree are not added together.

The empty `dropNotes` arrays in `store-baseline-1.json`, `store-baseline-2.json` and `store-before-worker-retirement.json` are **invalid**: they used `notes:%`. Zero-drop conclusions from them remain withdrawn. Drops and currently missing result keys have different denominators; 158 and 521 must not be subtracted or treated as conflicting counts.

## Skipped loaders and storage

**[Verified by experiment: final saved state, with current daemon labels only.]** Functions with `uncovered` state beside a file marked `unknown, skipped`:

| Retained tree(s) | Latest recorded daemon | Pass functions | Unknown functions |
| --- | --- | ---: | ---: |
| `b5981c18`, `5a05dafd`, `023aeeb2` | 0.1.368 | 4,329 each | 711 each |
| `13dbcff4` | 0.1.368 | 4,316 | 656 |
| `a1964cc6` | 0.1.367 | 4,213 | 776 |
| `6a7f8df3` | 0.1.367 | 4,193 | 796 |
| `0ac0429b` | 0.1.367 | 1,455 | 296 |
| `395c869a` | 0.1.367 | 262 | 544 |
| `10635869` | 0.1.357 | 0 | 3,929 |

These are snapshots, not independent functions across trees or proof that the named latest daemon produced each state. The reader trees are excluded. The first baseline's 0.1.366 coordinator had 4,272 pass and 677 unknown; differing files and worktrees prevent a paired improvement estimate. Full file-state and CRAP counts are in [final-unknown.json](data/final-unknown.json).

**[Verified by experiment: gross shared-store sizes, 06:32:34 UTC reading.]**

| Measure | Baseline 1, 07:41 Oct 27 | Baseline 2, 08:53 Oct 27 | Final |
| --- | ---: | ---: | ---: |
| `code.sqlite` bytes | 3,369,955,328 | 3,373,985,792 | 3,442,831,360 |
| Coverage records | 106,503 | 106,503 | 116,573 |
| Record bytes | 3,063,363,622 | 3,063,363,622 | 3,085,330,239 |
| Shared parts | 7,711 | 7,711 | 25,554 |
| Part bytes | 3,595,815 | 3,595,815 | 12,341,980 |
| `store.sqlite` bytes | 1,240,227,840 | 1,237,385,216 | 1,308,073,984 |

The code file grew **72,876,032 bytes** from baseline 1 and **68,845,568** from baseline 2. Manifest plus new-part bytes grew **30,712,782**, about **3.05 KB per new record**, against the first-stage full-record cohort's **35.3 KB** and interim manifest estimate of 2.42 KB. Gross file growth divided by retained completed test-file results is **6.88/6.50 KB**; divided by slots scheduled in completed runs it is **6.14/5.80 KB**. Baseline 1 includes time before the window; no observed run started between window start and baseline 2. These are normalization ratios, not isolated marginal costs.

Physical sizes are global snapshots after the transcript cutoff, not an exact end-of-window store or a per-producer allocation. Reader tasks made no validation runs or coverage records, but their registration/count state can affect global bytes. Exact physical growth excluding those states cannot be recovered. The actual number of completed execution slots cannot be reconstructed from retained result rows alone; scheduled slots in completed runs are labeled separately. WAL sizes are saved separately; the main-file comparison follows the baselines' method and is affected by checkpoint timing. Parts can be shared by both providers and have refreshed used times. This window does **not** test seven-day retention.

## CPU, recommendation and verification

**[Read in saved experiment evidence: `notes.md`, 0.1.366.]** Reuse the isolated CPU result: on/off ratios **1.230 and 1.109** over five fixed edits. Two edit starts exceeded load 24, the ratio gap failed the preset agreement rule, and many checks failed in both arms. No third pair ran. This does not establish normal successful-validation cost or D10's cost goal. No new CPU measurement was made.

**[Inferred.]** Keep coverage opt-in. Preserve the useful in-process-test case, but do not generalize from it. Noise remains, the newest source-edit exposure is absent or unknown, most record producers lack proven versions, missing-record causes remain open, CPU evidence is inconclusive and retention is untested. The human owns any later default decision.

Reproduce saved aggregates without live state:

```sh
python3 -I docs/specifications/015-coverage-complexity/tasks/015-14/round-3/bin/final-audit.py --check
```

It checks 42 lines, 10,070 records, 10,592 settled results and reader-run exclusion. Fresh read-only extraction, with private scratch:

```sh
python3 -I docs/specifications/015-coverage-complexity/tasks/015-14/round-3/bin/final-transcripts.py /var/tmp/coverage-final-05fecde6
nice -n 19 node docs/specifications/015-coverage-complexity/tasks/015-14/round-3/bin/store.mjs /home/agent/projects/squeal/.git/squeal 2026-10-27T08:23:46Z > /var/tmp/coverage-final-05fecde6/store.json
```

Then run the bounded query (from the repository root):

```sh
round3=docs/specifications/015-coverage-complexity/tasks/015-14/round-3
nice -n 19 node "$round3/bin/final-store.mjs" /home/agent/projects/squeal/.git/squeal \
  /var/tmp/coverage-final-05fecde6/store.json \
  "$round3/data/store-baseline-1.json" "$round3/data/store-baseline-2.json" \
  "$round3/data/store-before-worker-retirement.json" "$round3/data/interim-store.json" \
  > /var/tmp/coverage-final-05fecde6/final-store-counts.json
```

It fixes the window and settlement cutoff. `unknown.mjs` supplies the state snapshot; exclude roots `a52cf0ea` and `05fecde6`. Fresh store readings can differ as retention and replacement proceed. The committed snapshots preserve this reading. All SQLite connections use `readOnly: true` and `PRAGMA query_only=1`.

Sources: [final brief](final-brief.md), [first stage](notes.md), [interim reading](interim.md), [window](../window.md), [saved summary](data/final-summary.json), [store snapshot](data/final-store-snapshot.json), [session counts](data/final-window.json), and the committed Round 2/Round 3 probes. The scripts contain extraction limits; the manual case file records the judgment evidence. No unrelated transcript text or credentials are published.

Verification: four Python scripts parse; `node --check bin/final-store.mjs` passes; every final JSON file parses; `final-audit.py --check` reproduces the saved aggregates. `git diff --check` passes. Squeal's affected-path read exits 3 and reports no test closure for the three entry scripts, zero known failures and six unknown broader test files. No test-suite result is claimed for these read-only research probes.

Coordinator check: the saved aggregate audit and syntax/JSON checks pass after integration. The parent's affected-path read also exits 3: no test closure for the named research scripts, lessons or board, zero known failures and six broader unknown test files. [Reader-tree retirement snapshot](data/final-reader-retirement.json) preserves both readers' recorded 0.1.368 daemon metadata and empty drop-note sets before cleanup; both still had zero validation runs. Worker 05fecde6 was collected at settled revision 0 and destroyed with no resources remaining.
