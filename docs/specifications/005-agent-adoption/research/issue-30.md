# Issue 30: exact test waits and browser consumers

Treat #30's selection defect as a duplicate of #6, already repaired by 005-67 in 0.1.204; use a release containing that repair before diagnosing another selection regression.

Examined 2026-10-17: installed Codex plugin **0.1.199**; checkout **0.1.208**, HEAD and the inspected `origin/main` both `6ea148155e0dd43ef3bb4bb88b2013b94eb6b4d3`. Plugin manifests confirm both versions. This is documentation-only research, with no product, board, spec or status changes. **Reproduced at the selector seam on 0.1.199; not reproduced on checkout 0.1.208 source or committed bundle.** The live cezarion timeout was not reproduced, because the bounded experiment uses an in-memory store and executes no scheduler or browser.

## Questions answered

| # | Question | Answer and evidence tag |
| --- | --- | --- |
| 1 | Does a known exact test path expand into browser consumers? | Installed 0.1.199: yes, 1 test + 83 synthetic browser consumers. Checkout 0.1.208 source and bundle: only the named test. **verified by experiment**, those versions. |
| 2 | Do source paths still select consumers? | Yes, 84 consumers for the source path in all three targets; mixed test/source arguments also select 84. **verified by experiment**, 0.1.199 and 0.1.208. |
| 3 | Is this new beside #6 and done row 005-67? | The selection mechanism is the same; 005-67 repaired it and added overlap regressions. **read in source code**, commit `2a937b59` and 0.1.208; 0.1.204 landing/review attribution is recorded in the board. |
| 4 | Can pending browsers still block an exact fast-test verdict? | They no longer enter that exact path's selected set in the probe. The real wait's sync, listing and scheduling can still delay a verdict; no timeout or exit-code experiment was run. **inferred**, 0.1.208 selector and `waitForNamed`. |

## Experiment and exact output

The probe followed the issue-6 fixture's overlap shape. It extracted the real selection functions from the installed bundle, checkout TypeScript and checkout committed bundle. Its mock store supplies valid local closures representing browser inputs `packages/cezar/src/**`. It contains both reported server test basenames and 83 synthetic browser paths. No glob expansion, daemon, database, suite or browser ran. This distinguishes the selection defect from the cause of pending browser work.

Exact command, from the repository root:

```sh
node --disable-warning=ExperimentalWarning docs/specifications/005-agent-adoption/research/probes/issue-30/selection.mjs > docs/specifications/005-agent-adoption/research/probes/issue-30/output.txt
cat docs/specifications/005-agent-adoption/research/probes/issue-30/output.txt
```

The probe checked load immediately before executing selectors. Its first and last output lines were:

```text
{"at":"2026-10-17T11:11:41.549Z","node":"v24.21.0","load1":16.96,"cpuCount":24}
PASS: 15 selector cases; installed expands exact tests, checkout source and bundle do not. No daemon started.
```

The one-minute load was **16.96 < 24 CPUs**, so the load gate allowed the probe. Both shell commands exited 0. Complete exact output, input hashes, named paths and counts: [`probes/issue-30/output.txt`](probes/issue-30/output.txt). **verified by experiment**, Node 24.21.0, Squeal 0.1.199/0.1.208.

| Argument | Installed 0.1.199 selected / browsers | Checkout source 0.1.208 | Checkout bundle 0.1.208 |
| --- | --- | --- | --- |
| `packages/cezar/src/workflows/ci-wait-refusal.test.ts` | 84 / 83 | 1 / 0 | 1 / 0 |
| `packages/cezar/src/workflows/destruction-results.test.ts` | 84 / 83 | 1 / 0 | 1 / 0 |
| `packages/cezar/src/workflows/ci-wait-refusal.ts` | 84 / 83 | 84 / 83 | 84 / 83 |
| first test + source | 84 / 83 | 84 / 83 | 84 / 83 |
| `missing.ts` | 0 / 0, unmatched | 0 / 0, unmatched | 0 / 0, unmatched |

## Why, and comparison with existing work

**read in source code, 0.1.199:** the installed bundle's `selectNamedFiles` filters every row by `row.testFile.path === rel2 || closures.get(row)?.has(rel2) === true`. A known test path therefore includes all valid reverse-closure consumers. **read in source code, 0.1.208:** `src/cli/status-wait-paths.ts` first finds `own` rows whose path equals the argument and uses them when nonempty; only other paths reach closure selection. The committed bundle implements the same branch. These are CLI selection rules, not browser runner rules.

**read in source code, 0.1.208 and its history:** commit `2a937b59b590b82dcdadd311160fcecca0164444` implements 005-67. Its `test/cli/status-wait-paths-overlap.test.ts` covers overlapping sibling inputs, a unit test inside a browser source-input glob, an imported test, source consumers and mixed arguments. The inspected `origin/main` board marks 005-67 done in **0.1.204**, review 1 at `3c9949a8`, re-review PASS at `6e1f965b`. The version attribution is documentary evidence; 0.1.204 itself was not executed here.

**inferred, 0.1.199 report versus 0.1.208:** #30 is the same selection defect as #6, including #6's server-test-to-browser examples. Earlier research at `a8ceaa80` (0.1.200) and its real 0.1.199 CLI probe found the expansion; that older checkout finding is consistent with today's fixed checkout. The tradeoff is precise named-file scope while keeping reverse closure useful for source arguments. Exact selection does not remove dependents from background work.

**read in source code/spec, 0.1.208:** 011 C15 concerns queue promotion and pending reasons, with code rows 011-11/011-12 running in the inspected board. It does not change which files a path selects. `waitForNamed` still gates readiness on daemon synchronization and a listed revision. Selection alone therefore does not prove prompt red/green completion.

## Spec sections touched by the issue, and open questions

- **005 D2**: exact-test versus source selection and selected-file verdict; **005 Testing**: overlap regression coverage. No normative change is needed for the reproduced defect.
- **011 C15**, related **C4/C6**: named demand, scheduling/listing constraints and reporting pending state. These are adjacent to the delay claim, not evidence of a new selector defect.
- #30 additionally asks to show explicitly when an argument selects a broader closure. At 0.1.208 `selectedLine` prints `Selected: ...` with a capped file list, but gives no per-argument reason. **read in source code**, `src/cli/status-wait-lines.ts`. Whether richer explanation is wanted remains a coordinator/human scope decision; 005-67's done-when does not require it.
- Why the original 83 browser files remained pending, and whether the exact named result would settle promptly with the repaired CLI: **not determined, because** no original session store/logs or live scheduler were examined. This experiment claims neither the original timeout nor its exit 3 was reproduced.

## Sources and verification scope

- [Issue #30](https://github.com/hearsay-tools/squeal/issues/30), fetched with `gh issue view 30 --repo hearsay-tools/squeal --json number,title,body,comments,url`; [issue #6](https://github.com/hearsay-tools/squeal/issues/6), fetched with `gh issue view 6 --repo hearsay-tools/squeal --json title,state,body,comments`. Their timeout accounts are reports, not new experimental findings.
- [`issue-6-exact-file-waits.md`](issue-6-exact-file-waits.md) and its [`probe`](probes/issue-6-exact-file-waits/README.md), read only; [`005-67 commit`](https://github.com/hearsay-tools/squeal/commit/2a937b59b590b82dcdadd311160fcecca0164444).
- `git show origin/main:docs/board.md`: standing choices, 005-67 and 011-11/12; `docs/process.md`, `docs/vision.md`, `docs/styleguide.md`; 005 `spec.md` D2, Testing and `status.md`; 011 `spec.md` C15, all at `6ea14815`.
- Installed `/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs` and `.codex-plugin/plugin.json`; checkout `src/cli/status-wait-paths.ts`, `src/cli/status-wait-lines.ts`, `plugins/claude-code/dist/cli/squeal.mjs`, `package.json`, and overlap test. Probe method: [`README`](probes/issue-30/README.md).

Verification was the 15 standalone selection cases and documentation diff/syntax checks. No full suite, build, lint or typecheck was run for these research-only files. No daemon was started by this research, so none required stopping.
