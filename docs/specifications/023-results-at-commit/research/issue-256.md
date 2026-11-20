# Issue 256: imported testkit break reads not red

2026-11-20. Recommendation: ask the human whether to pursue a clearer explanation of which helper version proof uses, then verify the original case with `--source` before treating it as a key defect.

## Questions and verdict

| Question | Answer and evidence |
| --- | --- |
| Was the reported failure reproduced? | **Not reproduced, because** the one-minute host load reached 30.01 on 24 CPUs immediately before the planned live probe. The human required skipping above the CPU count. No proof or test command was run. |
| Which version was selected? | **Verified by experiment:** `node --disable-warning=ExperimentalWarning "$SQUEAL_CLI" --version` printed `0.1.578`. This was the installed Claude Code plugin's shipped CLI, not a local build. The issue could not distinguish its original 0.1.572 run from 0.1.578. |
| Can the named helper replace the broken base helper? | **Read in source code, 0.1.578:** yes. All positional paths join the test-side set. Source proof copies changed test-side files from HEAD over base code before keying. `--source` excludes a path from that copy. |
| Does the issue establish stale-store reuse? | **Inferred:** no. Its red provenance says `pass, run by this command, stored`, which describes a fresh run followed by storage. Copying the corrected positional helper offers another explanation. The original checkout, JSON and result keys were not inspected. |
| Is this the same defect as #247? | **Read in repository docs:** #247/row 023-21 is closed and released in 0.1.568. It concerned omitting an imported test-side helper. #256 explicitly names the helper, but expects its broken base version. Related policy boundary; no exact duplicate established. |

## Sources and mechanism

**Read in source code, repository 0.1.578 at `e3063559a54cb94c74d5b50acca075227e8f3ca8`:** [`src/cli/proof.ts`](../../../../src/cli/proof.ts) `prove` builds `testSide` from positional `named` paths and `--with` paths. `sideOf` passes those paths to `testSideCopies`. [`src/core/proof/sides.ts`](../../../../src/core/proof/sides.ts) `sidesOf('source')` selects HEAD tests over base code; `isTestSide` classifies a positional path as test-side, unless `--source` names it. `testSideCopies` copies changed test-side blobs from the test version. [`src/cli/proof-side.ts`](../../../../src/cli/proof-side.ts) keys the resulting checkout and then reads or runs the side.

**Inferred for the original incident:** naming `runners-under-test.testkit.ts` positionally can replace the deliberately broken base guard with HEAD's corrected guard. `not red` would then describe the composed tree correctly. A helper not independently listed by a runner can also explain the extra `not comparable`, as verified for the earlier issue in [issue-247.md](issue-247.md). Neither explanation was verified against #256's commits. No change to keying is justified by this source reading alone.

Spec sections touched: [023 D2 and D5](../spec.md), especially D5 introduction, D5.1 (key and provenance), D5.2 (test-side copy versus `--source`), D5.5/D5.6 (verdict and aggregate exit), and Testing. The related regression-proof wrapper request should remain part of the human's scope decision; its implementation was not examined here.

## Commands and load evidence

Commands actually run:

```sh
gh issue view 256 --repo hearsay-tools/squeal --json body
cat /proc/loadavg
nproc
node --disable-warning=ExperimentalWarning "$SQUEAL_CLI" --version
ssh agent@apptension-lab 'bash -lc "cat /proc/loadavg; nproc"'
```

`SQUEAL_CLI` selected `~/.claude/plugins/cache/hearsay/squeal/0.1.578/dist/cli/squeal.mjs`. Host load readings while preparing: 21.40, 23.20, 21.96, 21.49 and 21.41; CPU count 24. The final pre-launch reading was `30.01 20.09 17.91`, so the live run was skipped. Initial coordinator load was 15.89/24. Lab VM load was `11.61 8.49 8.68` on 12 CPUs. A copy of the shipped runtime and probe script was staged in the task-owned `~/work/issue-256/` on the VM, then removed without launching a test or proof. No daemon was started and existing holds were left alone.

The [throwaway script](probes/issue-256/probe.sh) prepares a dependency-free node:test fixture in a new scratch repository. Its unchanged wrapper imports a helper whose guard changes from `false && guard` at base to `guard` at HEAD. It schedules four exact commands, all **not run**:

```sh
node --disable-warning=ExperimentalWarning "$SQUEAL_CLI" proof src/thin.test.cjs src/rows.testkit.cjs --base "$base" --case source --timeout 90 --json
node --disable-warning=ExperimentalWarning "$SQUEAL_CLI" proof src/thin.test.cjs --source src/rows.testkit.cjs --base "$base" --case source --timeout 90 --json
node --disable-warning=ExperimentalWarning "$SQUEAL_CLI" proof src/thin.test.cjs --with src/rows.testkit.cjs --base "$base" --case source --timeout 90 --json
node --disable-warning=ExperimentalWarning "$SQUEAL_CLI" proof src/thin.test.cjs --source src/rows.testkit.cjs --base "$base" --case source --timeout 90 --json
```

The last call would check store reuse after the `--with` variant. These are planned probes, not evidence of outcomes. No full suite, targeted test or live proof pass is claimed.

## Human decision

Decide whether to approve a narrow helper-version explanation and reproduction with `--source`, including whether to include the wrapper request. Preserve the approved explicit test-side/product-side policy. If the corrected call still passes red, record its JSON, checkout inputs and keys before proposing a key repair. No implementation is authorized by these findings.

Sources: [issue #256](https://github.com/hearsay-tools/squeal/issues/256), fetched via `gh`; [023 status](../status.md); [issue #247 findings](issue-247.md); source files above; load/version commands above.
