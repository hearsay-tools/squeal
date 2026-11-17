PASS a7a060a289f95c17013483f369bd46270e40d676

0 blockers, 0 should-fix findings, 0 nits. Review of `cand/rewrite-test-ids`, pinned to the SHA above. Scope: its one commit relative to its parent on main. The review worktree and the independent clone both matched the pinned SHA. No product code changed during review.

## Verification

A new, full clone came from `https://github.com/hearsay-tools/squeal.git`. It used no local object alternates. `git rev-parse --is-shallow-repository` returned `false`. The clone was checked out with `git checkout --detach a7a060a289f95c17013483f369bd46270e40d676`. The commands below ran there on Linux, Node 26.13.0, pnpm 12.15.0.

| Command | Actual result |
| --- | --- |
| `timeout 300 pnpm install --frozen-lockfile` | Exit 0. Frozen lockfile accepted. |
| `timeout 180 pnpm run lint` | Exit 0. `Checked 3606 files in 964ms. No fixes applied.` |
| `timeout 180 pnpm run typecheck` | Exit 0. |
| `timeout 180 pnpm run build` | Exit 0. |
| Targeted command below | Exit 0. `Test Files 5 passed (5)`, `Tests 22 passed (22)`. Duration 30.20 s. JSON report: 0 failed, 0 pending, 0 todo. |
| `git status --short` after install, lint, typecheck, build and tests | Empty at every step. No bundle drift. |

```sh
timeout 600 pnpm exec vitest run \
  test/code/count/corpus.test.ts \
  test/daemon/handover.test.ts \
  test/daemon/start-handoff.test.ts \
  test/daemon/step-down.test.ts \
  test/e2e/run-triggers-control.test.ts \
  --maxWorkers=4 --reporter=verbose --reporter=json \
  --outputFile.json=../targeted.json
```

This direct run was required by the brief to verify a fresh GitHub clone. The session's Squeal results belong to the review worktree and cannot prove that the new pins exist in a fresh clone. The e2e file is also outside Squeal's configured coverage. No local full suite ran.

The review worktree also ran `squeal status --wait 60000` for these five paths, using the session’s absolute launcher. At revision 0 it reported no known failures and current results for all five selected files (the four covered requested files plus `test/version-sensitive.test.ts`). It returned exit 3 because the requested e2e file has no Squeal verdict of its own. The worktree had 36 unknown test files outside that selection. The independent fresh-clone run above supplies the e2e evidence; no claim is made for those unknown files.

CI observations for the exact pinned SHA:

- [Private material 44089504250](https://github.com/hearsay-tools/squeal/actions/runs/44089504250): completed, success.
- [CI 44089504206](https://github.com/hearsay-tools/squeal/actions/runs/44089504206): in progress at the last read. Its final result is unverified. This review does not claim a full-suite pass or release clearance.

## Commit mappings

**Proven:** `git cat-file -t <new-id>` returned `commit` for all 16 unique replacements in the fresh clone. For every pair, `git log -1 --format='%aI%n%cI%n%B' <id>` produced identical author dates, committer dates and full messages: the old ID was read from the retained host repository and the new ID from the fresh clone. No old object was fetched into the fresh clone.

| Old ID | New ID | Author date, unchanged |
| --- | --- | --- |
| `f0c99a2e7` | `98c5c9565` | 2026-10-26T11:16:30+01:00 |
| `97144d9` | `4ebea88` | 2026-10-09T17:32:14+02:00 |
| `2513bbdc` | `978a8a48` | 2026-10-12T23:55:01+02:00 |
| `8654424` | `a23fb89` | 2026-10-08T09:43:33+02:00 |
| `dbeb862` | `2a31f7c` | 2026-10-08T14:22:54+02:00 |
| `24a8a63b6` | `a753102e4` | 2026-11-02T12:19:29+01:00 |
| `e34c9bc1f` | `4fa5c3c0c` | 2026-10-27T13:43:25+01:00 |
| `e90e0030ccfef2ee90eabe9db3046c398ebdd3e5` | `7517daa5d41ea0d90304efc0aef9b94eeaf3f23a` | 2026-10-23T21:26:52+02:00 |
| `5f425783` | `9a48aae1` | 2026-10-15T07:05:16+02:00 |
| `2639208a` | `3433ae62` | 2026-10-18T21:59:38+02:00 |
| `87d7ced6` | `325022b0` | 2026-10-18T23:25:59+02:00 |
| `eec505f3b` | `958591e4a` | 2026-10-26T05:30:41+01:00 |
| `b9ef6a7e3` | `dad77eec3` | 2026-11-05T10:03:27+01:00 |
| `4204b3d47` | `43a16f75c` | 2026-11-04T18:10:01+01:00 |
| `45eb4b8a1` | `e2e67ff84` | 2026-11-05T12:27:18+01:00 |
| `1119021a6` | `36cab1170` | 2026-10-25T14:04:24+01:00 |

The functional pins also retain their package versions:

| Consumer | New pin | Version read from that commit's `package.json` |
| --- | --- | --- |
| `handover.test.ts` R31; `start-handoff.test.ts` PRE_CANCEL; `step-down.test.ts` PRE_STEP_DOWN | `a23fb89` | 0.1.31 |
| `handover.test.ts` R32 | `2a31f7c` | 0.1.32 |
| `run-triggers-control.test.ts` V0_1_393 | `a753102e4` | 0.1.393 |
| Both code corpus JSON files and their README | `7517daa5d41ea0d90304efc0aef9b94eeaf3f23a` | 0.1.279 |

## Remaining old tokens

**Proven by scan and use-site inspection:** no remaining host-only ID is passed to git by a test. `rg -o --no-heading --with-filename '\b[0-9a-fA-F]{7,40}\b' test/` found 597 unique tokens. A second scan of all 2,962 tracked paths under `test/`, including symlink text, found the same set. Each token was checked with `git cat-file -e` against the fresh clone, then the retained host repository. Results: 43 resolve in the fresh clone; 14 resolve only on the host; 540 resolve in neither.

The 14 host-only tokens are retained for these reasons:

| Token | Inspected use |
| --- | --- |
| `09956c8f` | Comment in `state/fingerprint-upgrade.test.ts`. |
| `11f8123b3` | Comment in `cli/install-sh-codex.test.ts`; the test explicitly restates a copy and runs no released CLI. |
| `1bc146f0` | Comment showing old output in `e2e/agree.ts`. |
| `231ecaeb0`, `5ecb377a8` | Comments in `scheduler/tier-yields-named.test.ts`. |
| `276ed939` | Historical note in `keys/validity/notes.md`. |
| `581f1772dc45` | Synthetic eval path in `harness/primer-wait.test.ts`; its length is asserted. |
| `833135b2fba0` | Eval cell path in `evals/cell-runtime.test.ts`. |
| `8cf7973d` | Result metadata used by the reference grader in `evals/reference.test.ts`. |
| `903600d8` | Result metadata in the two eval regrade tests; regrade reads retained results and does not check out their commit. |
| `a8f6984d` | Expected rendered text in delivery/status tests; synthetic HEAD values pad the prefix with zeros. |
| `c00435c9e2baa51418f054c9990f2eae8dba6b1a` | Synthetic result metadata in atomic-trend and host-launcher tests; trend code displays it. |
| `c6320866` | Frozen local parser module filename and provenance comment in the eval evidence test. The import reads that file. |
| `da4963d76` | Comment in `scheduler/yield-check.test.ts`. |

## Daemon cases ran

**Proven:** the JSON report records 15 passed daemon tests, with none skipped: 7 in handover, 5 in start-handoff and 3 in step-down. In particular, both released-bundle handover cases, both stopping-daemon start cases, and the released 0.1.31 step-down case ran and passed. The restored `hasCommit()` guards do not hide these cases in a full fresh clone.

The corpus tests both passed: ESLint counts for 7,042 functions and radon counts for 488 functions. The control file passed both Claude Code and Codex comparisons against the 0.1.393 pin, plus its three load-reading tests.

## Meaning and handoff

**Proven:** all 22 changed files are byte-for-byte identical to their parent after replacing each changed 7–40 hex token with one marker. Both corpus JSON objects are identical after removing only their `commit` property. The diff changes 33 token occurrences, covering 16 unique mappings. Outside the executable pins and corpus commit fields, the changes affect comments and documentation only. Assertions, guards, fixture measurements, test data, product source, bundles and versions are unchanged.

No fix wave is needed. Keep the main CI result separate from this bounded review. Passing full-suite CI on the exact release commit remains required before release.
