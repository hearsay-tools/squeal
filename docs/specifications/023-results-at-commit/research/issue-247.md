# Issue 247: a regression row in an imported kit

2026-11-19. Recommendation: accept the reproduced gap for a human decision on test-side identification or an actionable warning; do not copy every changed import, because imports also contain the source fix being tested.

## Questions and verdict

| Question | Answer and evidence |
| --- | --- |
| Does an unchanged thin test lose the new row in its imported kit? | **Verified by experiment, shipped 0.1.563:** yes. One existing `src/*.testkit.ts` holds both the old and new rows. Naming only the unchanged `src/thin.test.ts` returns `not red`, exit 1. |
| Does explicitly naming the kit change the result? | **Verified by experiment, shipped 0.1.563:** the thin test becomes `proven`, with the new row failing on the old source and passing on HEAD. The kit also gets `not comparable (no runner lists it ...)`, so the combined command exits 3, not 0. |
| Is this a default-case or stale-store problem? | **Verified by experiment, shipped 0.1.563:** the initial fresh-repository call chooses `source` and runs red. A later explicit `--case source` still says `not red`. **Read in source code, 0.1.563:** classification of the kit as code-side controls its omission from the overlay. |
| Does the existing contract require all changed imports to be copied? | **Read in official docs, repository spec 023 D5 at `19abf0739`:** no. Source proof puts HEAD tests over base code; D5.2 names test-side helpers and fixtures. Its wording mentions imports the code version lacks, while the implementation also copies changed existing recognized test-side files. The boundary for unconventional kit names needs a decision. |

The reported symptom and per-test workaround are reproduced. The original four-kit Squawk incident, its exact command exit code and claimed 15-minute cost are **not determined**, because this bounded research used a small independent fixture. The issue says its full output and runtime version were not recorded at the time.

## Experiment

**Verified by experiment.** Host precheck: `cat /proc/loadavg` gave `0.96 0.50 1.52`; `getconf _NPROCESSORS_ONLN` gave `24`. The reproduction therefore was not skipped. All installs and proof runs took place on `apptension-lab`, in the task-owned `~/work/issue-247-e4a2bb83/` directory. VM precheck was `0.00 0.00 0.00` on 12 CPUs; after the clean run it was `0.27 0.08 0.02`. No full suite or daemon was started. Afterward, `git worktree list` showed only the original fixture checkout, `git status --short` was empty and no probe process remained; the task-owned VM directory was removed.

Runtime copied from the installed Codex runtime `~/.codex/plugins/data/squeal-hearsay/versions/0.1.563/`, without rebuilding. `node "$SQUEAL_CLI" --version` printed `0.1.563`. Its CLI SHA-256 was `bea14d75e5ba510041cddf4d87ba5deb895db44e383bd4c4ba7d481d64990c48`, matching its `runtime.json`. Source inspected: `19abf07390279ac8f6ee9d8cc0d5d0dff4faa377`, package version `0.1.563`. VM tools: Node `v26.13.0`, pnpm `10.32.0`, Vitest `5.0.3`; resolved Vite `8.3.8`.

The [throwaway script](probes/issue-247/probe.sh) creates two commits. The unchanged wrapper imports and calls `runKit()`. At base the kit asserts `value >= 1`; HEAD adds `expect(value).toBe(2)` and fixes `src/value.ts` from 1 to 2. Vitest includes only `src/*.test.ts`. The kit is an imported module, not an independently listed test. `git diff --stat` confirms only the kit and source changed. Squeal uses ordinary empty `{}` configuration. XDG cache, data and config roots are isolated in the scratch directory.

Exact launch on the VM, from its login shell:

```sh
PROBE_ROOT="$HOME/work/issue-247-e4a2bb83/clean-run" \
SQUEAL_CLI="$HOME/work/issue-247-e4a2bb83/runtime/dist/cli/squeal.mjs" \
bash "$HOME/work/issue-247-e4a2bb83/probe.sh"
```

Clean fixture base: `6fde009d5dee7a40e5971a1af1d794ce89101a1b`; HEAD: `dece3995d0826e914c0b2b935d00d879085c1d32`. Commands below abbreviate that base as `$base`; the script passes its full SHA and invokes `node --disable-warning=ExperimentalWarning "$SQUEAL_CLI"`.

```text
proof src/thin.test.ts --base "$base" --timeout 120
squeal proof (case source): base 6fde009d5, HEAD dece3995d
src/thin.test.ts: not red
  red: pass, run by this command, stored
  green: not read
0 proven, 1 not red, 0 red for another reason, 0 not green, 0 not comparable; 1 run (2.8 s of the 120 s budget)
EXIT thin: 1

proof src/thin.test.ts src/rows.testkit.ts --base "$base" --timeout 120
squeal proof (case source): base 6fde009d5, HEAD dece3995d
src/thin.test.ts: proven
  red: fail, run by this command, stored
  new row catches the bug [assertion]
            AssertionError: expected 1 to be 2 // Object.is equality
                at src/rows.testkit.ts:5:53
  green: pass, run by this command, stored
src/rows.testkit.ts: not comparable (no runner lists it at dece3995d)
  red: unknown (no runner lists it at dece3995d)
  green: not read
1 proven, 0 not red, 0 red for another reason, 0 not green, 1 not comparable; 2 runs (3.4 s of the 120 s budget)
EXIT named-kit: 3

proof src/thin.test.ts --base "$base" --case source --timeout 120
src/thin.test.ts: not red
  red: pass, stored result
  green: pass, stored result
0 proven, 1 not red, 0 red for another reason, 0 not green, 0 not comparable; 0 runs (2.1 s of the 120 s budget)
EXIT explicit-source: 1
```

These are verbatim result excerpts; repeated side descriptions, runner stack frames and progress lines are omitted. An initial fixture attempt used unrecognized `version` and `vitest.configFile` configuration keys, emitted warnings and showed the same outcomes. The corrected fresh fixture above used `{}` and emitted no such warnings. No conclusion depends on that initial attempt.

## Mechanism and decision boundary

**Read in source code, 0.1.563:** [`src/core/proof/sides.ts`](../../../../src/core/proof/sides.ts), lines 37–62, classifies explicitly named paths, recognized test folders and names matching `*.test.*`, `*.spec.*`, `*_test.*` or Python test names as test-side. `src/rows.testkit.ts` matches none until explicitly named. Lines 96–108 copy changed or absent test-side paths from the test version. Therefore the first call retains the base kit, which has no new row. Naming the kit changes its side classification and copies the HEAD kit over the base source. This is not a failure to traverse the import for case selection: `defaultCase`, lines 71–79, examines changed paths in the loaded closure.

**Read in source code, 0.1.563:** [`src/cli/proof.ts`](../../../../src/cli/proof.ts), `prove`/`sideOf`, and [`src/core/commit/at-keys-side.ts`](../../../../src/core/commit/at-keys-side.ts), `sideKeys`, distinguish paths named for overlay from files actually listed by the runner. A named helper can affect the wrapper's overlay and still have no runnable identity itself, consistent with the observed extra `not comparable` verdict.

**Inferred from the experiment and D5:** blindly overlaying every changed import would overlay `src/value.ts` too and erase this fixture's old-source failure. The human decision is whether proof should identify additional test-side modules automatically, or explain the unchanged wrapper and changed imports before an agent mistakes this red-side pass for evidence about its new row. A diagnostic-only response does not settle automatic overlay policy. Any approved helper-naming route must also decide whether non-runnable helpers belong in the overall proof verdict. No implementation or spec amendment is made here.

Sources: [issue #247](https://github.com/hearsay-tools/squeal/issues/247), fetched with `gh issue view 247 --repo hearsay-tools/squeal --json title,body,url,comments`; [023 spec D5](../spec.md); [023 status](../status.md); source paths above at `19abf0739`; shipped-runtime experiment and [probe instructions](probes/issue-247/README.md). No broader repository validation is claimed.
