# Issue 267: folder selection in a narrow group run

2026-11-23. Recommendation: approve a bounded repair to make real folders select
their listed descendants in narrow group runs, preserving group ownership and
the existing source-file edit rule.

**Verdict:** reproduced at the source-selection boundary. The original CLI run
on the reporter's worktree was not reproduced. No product changes, test suite,
daemon restart or workload on boat.dev were needed.

## Questions and answers

| Question | Answer and evidence |
| --- | --- |
| Can a folder select nothing for a narrow run while status selects its tests? | **verified by experiment**, checkout 0.1.604: the actual selectors over the same two-file synthetic listing return zero versus two. |
| Do individual test paths work? | **verified by experiment**, checkout 0.1.604: both paths select both files in group `run-loop`. |
| Why do the paths differ? | **read in source code**, 0.1.599 and 0.1.604: status recognizes real folders; the narrow-run selector treats any non-test path as source edit work. |
| Was the exact reported command reproduced? | Not determined on the original worktree: no original daemon/store was inspected and no original parity tests ran. |

## Versions, load and commands

**read in official docs** (issue report, not independent validation):
[#267](https://github.com/hearsay-tools/squeal/issues/267) names Squeal 0.1.599,
revision 20, worktree `98f00b7876a301f1`, Claude Code. Its command was:

```sh
squeal run run-loop packages/cezar/src/workflows/waits-parity.test.ts packages/cezar/src/core/ui-parity.test.ts packages/cezar/src/runners/antigravity/ --wait 60000
```

It reported `packages/cezar/src/runners/antigravity selects no test file of any
group`; the reporter says individual parity files and a folder status wait work.

**verified by experiment**, this session: installed launcher **0.1.600**,
checkout **0.1.604**, commit `f04de26bf0c82439130a7cfd10cb2f1895bd6d01`.
Session registration also named 0.1.600. Read-only commands:

```sh
gh issue view 267 --repo hearsay-tools/squeal --json title,body,url
cat /proc/loadavg
nproc
git rev-parse HEAD
node -p "require('./package.json').version"
node --version
~/.codex/plugins/data/squeal-hearsay/bin/squeal --version
~/.codex/plugins/data/squeal-hearsay/bin/squeal checks
git diff squeal--v0.1.599 HEAD -- src/core/scheduler/narrow-run.ts src/cli/named-selection.ts src/cli/run-group-narrow.ts
git diff --stat squeal--v0.1.599 HEAD -- src/cli/run-group-wait.ts
```

CPU count was **16**. One-minute load was **13.93** at the first recorded check,
**14.06** on the next, and **12.76** immediately before the probe, below the
user's skip threshold. Node was **v26.13.0**. `squeal checks` showed only the
default `tests` group: 2,162 files, 1,103 pass and 1,059 not current. Those are
background results, not a suite pass or evidence about this defect. The diff
commands printed nothing: these four files are unchanged from
reported version 0.1.599 through this checkout.

## Selection experiment and source trace

**verified by experiment**, checkout 0.1.604:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-267/select.mjs
```

Exit **0**, wall time **0.43 s**. The [probe](probes/issue-267/select.mjs) imports
the product functions, supplies one real folder and a synthetic listing of two
tests underneath it, and configures `run-loop` at `pause`. Its inert runner and
empty dependency index express the ordinary case where nothing imports or reads
the directory itself. The trailing slash passes through `worktreePath`, as the
CLI normalizes it. Results:

| Call | Selected | Unmatched |
| --- | --- | --- |
| `selectNarrow(folder)` | 0 | The folder |
| `selectNamedFiles(folder)` | 2, `kind: "directory"` | None |
| `selectNarrow(each test file)` | 2 in `run-loop` | None |

Only the folder narrow selection called `runner.affected`, once with the folder
path. No runner executes; no actual test-file content, store, scheduling, socket
or wait behavior is exercised. This cheap probe needed no host isolation or
heavy work, so boat.dev was not used. See its [README](probes/issue-267/README.md).

**read in source code**, identical files in 0.1.599 and 0.1.604:

- `src/cli/named-selection.ts`, `selectNamedFiles`: calls `folderPath`, then
  filters the listed test files by folder containment. It bypasses reader lookup.
- `src/cli/run-group-narrow.ts`, `runNarrowCommand`: uses `worktreePath` and sends
  `run-group-paths`; it does not expand folder descendants.
- `src/core/scheduler/narrow-run.ts`, `selectNarrow`: exact listed test paths
  select themselves. All other paths go through `runner.affected`, the reverse
  index and `editWork`. It has no folder branch; a directory with no such edges
  enters `unmatched` despite holding listed tests.
- `src/cli/run-group-wait.ts`, `endedLine`: renders that unmatched result
  as `selects no test file of any group`.

**inferred**, report plus 0.1.599/0.1.604 source: this missing folder branch
explains the reported contrast. A folder with dependency edges might select
some readers; that does not supply the promised descendant selection. The
original runner's actual affected answer remains unknown.

## Scope and remaining evidence

**read in official docs**, current repository specifications: 005 D2 and
011 C15 explicitly define real-folder selection for status (row 011-406,
gh-169). 019 D6's narrow run defines exact test files and source edit work;
it has no explicit folder rule. A repair therefore needs the coordinator's
accepted folder rule in D6 as well as code and targeted regression evidence.
011 C6 owns the status surface; 011 C15 owns named demand. Status folder support
alone does not establish that a group run implemented it.

**inferred** recommendation for the approved row: verify same-group, mixed-group
and other-group-only folders; retain other-group attribution, source-file edit
selection and honest unmatched reporting. Verify the CLI-to-daemon path on a
small fixture on boat.dev before claiming an end-to-end fix. Keep root paths,
trailing slashes and nested working directories explicit in that scope. No
design, implementation or broader policy change is authorized by this finding.
