# Left-out files in squawk's export (row 018-40)

Researcher, 2026-11-12. Run: `hearsay-tools/squawk` merge group run 43188846583 at `cc3cead4`, Squeal 0.1.443 (`ebd52be86`). The source files cited below did not change between `v0.1.443` and this branch's base `2c4d01751`. Probes: `probes/left-out-files/` (throwaway).

**Method.** I replayed the export locally (`verified by experiment`). I used a fresh clone of squawk at `cc3cead4`, the job's own steps (`pnpm install --frozen-lockfile`, no build) and the run's eight downloaded parts. Squeal 0.1.443 was patched only to write its full left-out list. The replay gives the same result as CI: 1484 exported, 24272 results, 150 + 31 left out. All 1484 keys and the environment hashes equal those in CI's `squeal-results.json.gz`. For each of the 4495 left-out (file, input) pairs, `classify.mjs` compares the file's own shard evidence, the other shards' evidence, the file's observed reads and the clone's content.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Which input differed, grouped by cause | **No input differed in content.** In all 4495 pairs, the input is **absent** from its own shard's evidence. Not one pair had a different hash. There were no built files, no generated or time-stamped content, no files outside the repository and no shard-specific checkout. Seven causes, below. | verified by experiment |
| 2 | Which causes can be handled soundly; share recovered | Two recorder defects, fixed in `ci record` without a key change: **84 of the 150 files, 1601 of their 2055 test seconds (78%)**. A further 56 files (366 s) need a change to D9's evidence rule. The last 10 files (88 s) must stay left out. | verified by experiment (counts); inferred (soundness) |
| 3 | The 31 duplicate-name files | **squawk's test names collide.** The 31 files have 44 such names, mostly from `it.each` rows that print alike. **Squeal's part format makes them a reason to leave a file out.** The daemon names a repeat `name (line N)`. The CI run records no test locations: 0 of 26873 checks have one. 178 test seconds. | verified by experiment; read in source code |
| 4 | Row or none | **One row:** the two evidence fixes and test locations in `ci record`. Up to 115 files and 1779 s per merge run, about 80% of the left-out test time. The D9 change is a question for the human, not part of the row. | inferred |

## Findings

### 1. Causes (150 files; per-file list in `probes/left-out-files/causes.tsv`)

| Cause | Files (only this cause) | Test s | What happens |
|---|---|---|---|
| A. Spawn argument with no read | 60 (+15 with B, +2 mixed) | 1113 | squawk passes `pi-retry-degraded-service.mjs`, `pi-project-skills.mjs` and `pi-default-tools.mjs` to the mock `pi` as `--extension <path>`. The mock never opens them. The daemon's recorder keys every existing file path in a spawn's arguments (`src/runners/observe/spawn.cjs:143-155`, `recordArguments`, which uses `statSync`, not a read). So the test's observed reads and its key hold the scripts. The CI evidence hooks record no argument (`ci-runtime/children.cjs`, `evidence-hooks.cjs`). A shard holds evidence for a script only when another test in it imports the script. That was 3 of 8 shards for each script, which explains the random spread. Locally, `harness-autosave-settlement.test.ts` alone gives no evidence line and no write line for the three scripts. The same cause applies to `sgconfig.yml`, which is passed to the native `sg` binary as `--config`. | verified by experiment; read in source code |
| B. Unlinking a symlink marks its target written | 9 (+15 with A) | 143 (the 15 with A: 345) | In shard 5, `cursor-print-runner.test.ts:283-289` runs `symlinkSync(mock, <tmp>/cursor-agent)` and later `unlinkSync(<tmp>/cursor-agent)`. The REMOVES hook calls `evidence.write` (`evidence-hooks.cjs:128`). `write` then marks the path the link reaches (`evidence.cjs`, `write`/`reached`), which is the real `packages/cezar/scripts/mock-cursor-print.mjs`. The trace run shows this stack. Removing a link does not change its target, but the export cancels the script's evidence for the whole shard. That drops 24 shard-5 files that run the mock. 31 child processes read it with the commit's hash. | verified by experiment |
| C. Static import never loaded | 56 | 366 | The Vite graph keeps targets of dynamic imports (`src/runners/vitest/graph.ts:154-168`). The shard never loads them: `lazy(() => import('./routes/…'))` in `packages/web/src/routes.tsx` (48 web files), `vi.mock` factories (15 files have one) and `await import('./discovery/cli.ts')` in `packages/cezar/src/subcommands.ts`. Each input was read **with the commit's content in another shard**. No hooked process of the file's own shard read it, so no evidence exists. Locally, `command-palette.test.tsx` neither reads nor observes any of its 84 left-out inputs. | verified by experiment |
| D. Native reader only | 5 (1 alone, 4 mixed with A, C, G) | 87 | `ast-grep-rules`, `lint-runner` and `lint-ast-grep-1/-2` declare `.ai/ast-grep/**` in squawk's `squeal.config.json` `inputs`. Only the native `sg` reads those files. `inline-contract-check.test.ts` runs `scripts/inline-contract.mjs`, which bundles `packages/contract/src` with esbuild, also native. D8 already names this gap ("a file only native code … reads"). | verified by experiment (absent everywhere); read in source code |
| E. `require` inside a string literal | 3 | 1 | The regex `REQUIRE` in `src/runners/vitest/loads.ts:2` matches `require('../home/resolve.cjs')` inside fixture strings, for example `test-home-write.test.ts:150`. The key then holds every missing Node candidate (`resolve.cjs.js`, `…/index.ts`, …). No process probes them. | read in source code; verified (paths missing, never probed) |
| F. Absent snapshot of a skipped file | 2 | 0 | `windows-workspace-{identity,security}.test.ts` use only `it.runIf(win32)`. Their key holds the missing `.snap`, and Linux never probes it. | verified by experiment |
| G. Other observed read | 1 input (inline-contract-check's `packages/contract/tsconfig.json`) | — | Observed but absent from evidence. The cause is **not determined**: the file is left out anyway by D. | — |

Every left-out input is **absent**, never different. So the export's comparison with its fresh checkout never fired in this run. Every left-out file is caused by evidence the shard did not take.

### 2. What is sound to recover

- **A (sound, inferred).** At spawn time, the hook hashes each file-path argument that the daemon's recorder keys, as a read in the parent. This is the same moment and the same rule as `recordArguments`, and a write in the run still cancels it. For a native child, this is the gap D8 already accepts ("between a hash and the read it stands for"). Keys do not change: the daemon already keys these paths.
- **B (sound, inferred).** `unlink`, `rm` and `rename` act on a link, not on what it reaches. So their hooks should not mark the target. Writes through a link (`writeFile`, `truncate`, `utimes`, `link`) still must. Keys do not change.
- **A + B: 84 files, 1601 s.** That is 78% of the 2055 left-out test seconds and 13% of the run's 12123 s. Exported files go from 1484 to 1568 of 1665 (89% to 94%).
- **C (56 files, 366 s): only with a rule change.** One option is evidence from another shard (all 56 are certified there). The other is a hash of each tracked file at command start. D9 (2026-11-09) rejects both: only the file's own shard's read-time evidence counts, and "neither a clean checkout nor a path git did not report stands for evidence". This run gives a counterexample to the idea that a file no hooked process read cannot matter. `inline-contract-check`'s result depends on `packages/contract/src/*`, which only esbuild reads in its shard. A cross-shard rule would have certified those inputs. This decision is for the human.
- **D, E, F (10 files, ~88 s): stay left out.** D has no evidence at all. E could be fixed by a scanner that skips string literals, but that changes daemon keys for little gain. F concerns skipped tests with near-zero time.

### 3. Duplicate names

The 31 files have 44 shared names. Examples: `it.each([undefined, null, 0, -1, '4', 4])('…messageCount=%s')` (`'4'` and `4` print alike), `it.each(['', 'a'.repeat(201)])('rejects empty or oversized branch names…')` (no placeholder), and `$pathname` printing `undefined` twice. Vitest allows such names. The daemon's Vitest has `includeTaskLocation`, and `checkNames` names a repeat `fullName (line N)` (`src/runners/vitest/results.ts:102-116`). The CI command runs with the project's config, so `PartCheck.location` is `null` for all 26873 checks. That is why `export.ts` drops files with `sharedNames`. The fix is for `ci record` to set `includeTaskLocation` in the run it wraps, as it already adds the coverage provider. `export-check.ts:56-64` already leaves that field out of the descriptor comparison (inferred, not tried). This recovers up to 31 files and 178 s. They may still hit causes A to F once named; that was not checked.

## Recommendation

Add one row to spec 018: **evidence fixes for left-out files.** (1) `ci record` takes evidence of each spawn's file-path arguments, as the daemon's recorder keys them. (2) Removing or renaming a symlink no longer marks its target written. (3) `ci record` turns on `includeTaskLocation`, so the export names repeated checks as the daemon does. None of these changes a key. Acceptance: the same eight parts re-recorded on squawk export at least 1568 + 31 files. A test reproduces each cause with a fixture: the extension argument, the unlink of a symlink, and `it.each` with equal titles. Do not relax D9 for cause C without the human. If the human wants C, the measured gain is 56 files and 366 s per run, and the measured risk is native readers such as esbuild and ast-grep.

## Open questions

1. For the human: should evidence from another shard, or a hash at command start, certify a closure input that no hooked process of the file's own shard read (cause C: 56 files, 366 s)? D9 says no today.
2. Is `includeTaskLocation` free to set from `ci record` (test cost, descriptor)? Not measured.
3. Cause G (`packages/contract/tsconfig.json`) is not determined. It recovers nothing on its own.
4. The counts are from one run. Shard assignment changes with each merge, so A's spread (3 of 8 shards for each script) and B (whichever shard holds `cursor-print-runner.test.ts`) move between runs.

## Sources

- Run 43188846583, read-only: `gh run view --log` (export job 131087935864, shard 1 job 131083629505) and `gh run download` of `squeal-parts-shard-1..8` and `squeal-results`. Retrieved 2026-11-12.
- squawk at `cc3cead4`: `packages/cezar/src/core/pi-runner.ts:476-536`, `scripts/mock-pi-rpc.mjs`, `src/core/cursor-print-runner.test.ts:283-289`, `packages/web/src/routes.tsx:51-92`, `src/subcommands.ts:37-41`, `src/ast-grep-rules.testkit.ts:95-120`, `scripts/inline-contract.mjs:16-54`, `squeal.config.json` `inputs`.
- Squeal `v0.1.443`: `src/core/ci/export.ts`, `export-inputs.ts`, `inputs.ts` (`readRecorded`, `uncertified`), `src/runners/vitest/ci-runtime/evidence.cjs`, `evidence-hooks.cjs:92-150`, `children.cjs`, `src/runners/observe/spawn.cjs:143-155`, `src/runners/vitest/graph.ts`, `loads.ts`, `results.ts:102-132`, `src/cli/ci-export.ts:186-196` (`NAMED_FILES = 3`).
- Spec 018 D8 and D9 (`spec.md:183,187`).
