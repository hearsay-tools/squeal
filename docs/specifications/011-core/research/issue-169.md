# Issue 169: Vitest filters and named status

Treat this as a reproduced selection-compatibility gap, with a policy decision before implementation.

The mismatch is real on installed Squeal **0.1.423**. It follows the current exact-path contract. Prefix expansion would change that contract; a specific diagnostic could preserve it. The deciding tradeoff is compatibility with runner acceptance commands versus preserving the meaning of source-path selections. This research authorizes neither change.

## Questions and verdicts

| Question | Answer | Evidence tag and version |
| --- | --- | --- |
| 1. Does a Vitest filename prefix select the same tests in named Squeal status? | No. `test/cli/named-file` lists two files in Vitest and selects none in Squeal, twice. | **verified by experiment**, Squeal 0.1.423 / Vitest 5.0.3 |
| 2. Do explicit paths select those files? | Yes, both. Squeal shows both current/pass, but gives no final verdict because its snapshot sync is incomplete. | **verified by experiment**, 0.1.423 / 5.0.3 |
| 3. Does a genuine directory differ from a filename prefix? | No in this sample: `test/commit` is a directory; Vitest lists ten files, Squeal selects none. | **verified by experiment**, 0.1.423 / 5.0.3 |
| 4. Does this violate the current selection contract? | No. 005 D2 selects an exact test file or tests whose closure contains the exact path. It does not promise substring or directory expansion. | **read in official docs**, repository specs at `db3224c0f8203bf92363cfbbd87f89f191a8fdfe` (0.1.423) |
| 5. Is the mismatch explained by selection or missing discovery? | Selection. The exact controls are already listed. Squeal compares exact paths and closure-set membership; Vitest filters with substring matching. | **read in source code**, repository 0.1.423 and installed Vitest 5.0.3; controls verified above |
| 6. Was the original Cezar acceptance command reproduced? | Not determined: its exact command, contemporaneous Squeal version and output were not recorded in the issue. This is an equivalent local selection reproduction, not that original run. | **inferred**, issue 169 as fetched 2026-11-10 and experiment limits below |

## Experiment

Read issue 169 with `gh issue view 169 --repo hearsay-tools/squeal --json title,body,comments,url` (exit 0); its snapshot is [issue.json](probes/issue-169/issue.json). The brief's `005-agent-guidance` directory does not exist here; the D2 contract is in `005-agent-adoption`.

Environment: Linux x64, Node v24.22.1, Vitest 5.0.3, installed launcher reporting 0.1.423. Cwd is this task's worktree, `.../.ai/cezar/worktrees/9ebda6fe-cae9-475d-9500-2ea711d81fd6`, at commit `db3224c0f8203bf92363cfbbd87f89f191a8fdfe`. Before probes, `/proc/loadavg` read **4.26 8.37 7.61**, and `getconf _NPROCESSORS_ONLN` returned **24** (both commands exit 0). Every probe checked one-minute load again and would skip if above CPU count. Capture loads were **3.24–3.35**, then **3.08**, below 24. Captures ran on 2026-11-10 at **05:13–05:14 Europe/Warsaw**; raw records use UTC.

The probe uses existing repository tests as controls. It lists files without executing them and queries named snapshots without `--wait`, promotion or retry. It starts no daemon and requests no suite. No shared store is edited directly and no daemon is restarted. Normal daemon sync and observation of the new research files still occur.

For the exact commands below, set:

```sh
S=/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal
```

| Command | Output relevant to selection | Exit |
| --- | --- | --- |
| `"$S" --version` | `0.1.423` | 0 |
| `pnpm exec vitest --version` | `vitest/5.0.3 linux-x64 node-v24.22.1` | 0 |
| `pnpm exec vitest list --filesOnly test/cli/named-file` | `test/cli/named-file-end.test.ts`, `test/cli/named-file-lines.test.ts` | 0 |
| `"$S" status test/cli/named-file` | Empty `Selected:`; `no test file's closure holds test/cli/named-file` | 3 |
| `pnpm exec vitest list --filesOnly test/cli/named-file-lines.test.ts test/cli/named-file-end.test.ts` | Same two files | 0 |
| `"$S" status test/cli/named-file-lines.test.ts test/cli/named-file-end.test.ts` | Both selected; `Current (2): 2 pass`; no verdict due to incomplete sync | 3 |
| `pnpm exec vitest list --filesOnly test/commit` | Ten files: `boundary-daemon`, `boundary`, `compute`, `lint-told-daemon`, `lint`, `stop-told-daemon`, `store`, `stored-stall`, `stored`, `text` (all `.test.ts`) | 0 |
| `"$S" status test/commit` | Empty `Selected:`; `no test file's closure holds test/commit` | 3 |
| `"$S" status test/cli/named-file test/cli/named-file-lines.test.ts` | Only the explicit file selected; prefix still named unmatched | 3 |

Full argv, stdout, stderr, exits, load and timestamps are in [results.json](probes/issue-169/results.json) and [repeat-results.json](probes/issue-169/repeat-results.json). All captured stderr is empty. The prefix does not exist on disk; the directory does. The first capture wrote its record after each command, which generated research-file revisions. The repeat held its records in memory until all commands ended; every named result then read revision 6, with all 1,562 test files current. The selection results stayed the same.

**Limit:** even the repeat's exact-path control said `the daemon has not stored its pass over the latest edits`, so exit 3 alone does not prove a prefix-specific error. The proof is the selected-file sets and unmatched text, supported by the implementation. No successful exact-path *final verdict* was observed. No `--wait` run was made, because the narrow question could be answered without changing queue order or asking for runs. No test execution or full-suite result is claimed.

## Contract and source findings

**read in official docs, repository 0.1.423.** [005 D2](../../005-agent-adoption/spec.md#d2-a-wait-on-named-files) says: “A test-file path selects itself. Any other path selects the test files whose closure holds it.” It also specifies an unmatched path's exit 3 and the one-sync, non-promoting snapshot. [011 C6](../spec.md#c6-status) governs snapshot truth; [C15](../spec.md#c15-named-demand) governs named demand and `none` reasons, including `unsynced` before `unmatched`. [013 V3](../../013-vitest-runner/spec.md#v3-affected-closure-enumerate) defines affected, closure and check enumeration; it does not make named status a Vitest CLI filter. Their status amendment logs were checked; the current D2 text includes the 2026-10-26 daemon-reader amendment.

**read in source code, repository 0.1.423.** `src/cli/named-selection.ts:74–123` compares `row.testFile.path === rel`, otherwise checks `valid.get(row)?.has(rel)` or the daemon's exact-path readers. There is no prefix scan. `src/cli/status-paths.ts:112` and `status-wait-paths.ts:251` use that same selector. `src/cli/named-file-lines.ts:188–198` emits the observed closure message. `src/runners/vitest/adapter.ts:537–544` obtains the discovery list from `globTestSpecifications()`.

**read in source code, Vitest 5.0.3.** Installed `node_modules/vitest/dist/chunks/index.DpLw24bj.js:12276–12287`, `TestProject.filterFiles`, uses `testFile.includes(f.toLocaleLowerCase())` or the filter resolved relative to the project directory; it also accepts an absolute-path prefix. Thus a non-existent filename prefix can select files. The experiment proves the three cases above, not all case, platform or project-root variants.

**read in source code, repository 0.1.423.** Squeal already has a separate Vitest filter rule in `src/runners/vitest/describe.ts:167–199`, used to recognize covered runner commands. It is guarded by listing completeness and project constraints. This is not the named-status selector. Its existence does not establish that it can safely be substituted into status.

## Recommendation and open questions

**inferred, from 0.1.423 evidence.** Keep the issue as a reproduced usability gap for a human policy decision. A specific unmatched-prefix diagnostic is the smaller contract-preserving direction; transparent expansion offers closer compatibility with Vitest commands but changes selection semantics. The coordinator must settle that choice before implementation. Existing holds remain in force.

Open questions: whether to expand or only explain; precedence when a token is both a source path and a test substring; directory semantics across runner projects; whether an expanded selection should get exact-test promotion or source-path treatment. None was tested or decided here. The independent snapshot-sync limitation was observed, not diagnosed, and does not establish another defect.

Sources: [issue 169](https://github.com/hearsay-tools/squeal/issues/169); [Squeal source revision](https://github.com/hearsay-tools/squeal/tree/db3224c0f8203bf92363cfbbd87f89f191a8fdfe) at the paths above; the installed Vitest 5.0.3 distribution at the path above; linked specifications and their sibling `status.md` files. No open-web search was used.
