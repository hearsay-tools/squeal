# Issue #193: the gate's closure and module-hook notes, printed twice, with no verdict scope

Research for hearsay-tools/squeal#193 (reported on 0.1.443, 2026-11-12).
Probed with the packaged 0.1.443 CLI
(`~/.claude/plugins/cache/hearsay/squeal/0.1.443/dist/cli/squeal.mjs`, Node
v26.13.0). Source read at `e5e3ba77c` (`squeal--v0.1.443-5`); `git diff --stat
squeal--v0.1.443 HEAD -- src` is empty, so the source is 0.1.443's.

Verdict: **duplicate not reproduced; the scope gaps are confirmed.** In five
gate runs over a synthetic fixture with the issue's shape, each note printed
once per project. Source has one note-bearing adapter per project per gate
run, and that adapter prints each text once. The other half of the issue
holds: the closure note is written before selection and lists every
incomplete-closure test file of the project, whatever the change; the gate
JSON carries neither note; "declare it in inputs" names no file or key shape.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does 0.1.443 print each note twice? | No, not in 5 runs: once per project, both projects | verified by experiment |
| 2 | Is there a second emission path in source? | No: the store's key adapters get no note sink; the run adapter prints each text once | read in source code |
| 3 | What did print twice in the issue? | Not determined, because the reporter's stderr and harness are not available | — |
| 4 | Does the closure note say which files the change selected? | No: it is written at adapter open, before selection, over all the project's test files | read in source code; verified by experiment |
| 5 | Can an incomplete closure touch the verdict? | Yes: selection is static only; a change reached only by the computed `import()` selects no test and the verdict is `incomplete` (exit 3) | verified by experiment; read in source code |
| 6 | Is the full list in `--json`? | No: no field holds closure gaps or preload hooks | verified by experiment |
| 7 | What is the input key? | Top-level `inputs` in `squeal.config.json`: a glob list for every test file, or a map from test-file glob to input globs. Not a per-project key | read in source code |

## Host and commands

24 CPUs. One-minute load 2.26 at the start (05:15Z), 2.25 to 4.85 during the
runs, below the CPU count, so the probe ran. Total gate runs: five per probe
execution; the probe ran four times while it grew, the last run is in `results/`.

    VITEST_MODULES=$PWD/node_modules sh \
      docs/specifications/020-quality-gate/research/probes/issue-193/probe.sh \
      ~/.claude/plugins/cache/hearsay/squeal/0.1.443/dist/cli/squeal.mjs \
      docs/specifications/020-quality-gate/research/probes/issue-193/results

The probe (`probes/issue-193/probe.sh`, throwaway) builds a temporary repo:
two `nodeTest` projects, `unit` and `root:unit`, both with
`--import ./scripts/preload.mjs`; the preload imports `scripts/hooks-helper.mjs`,
which imports `node:module`; `test/math.test.mjs` imports `src/math.mjs`
statically and `src/extra.mjs` by a fully computed `import(name)`. HOME and
XDG directories point into the temporary directory. No daemon runs. Each case
runs `squeal code --base main --json`:

| Case | Change | Notes on stderr | Verdict |
|---|---|---|---|
| `unrelated` | `.github/scripts/ci.cjs` only | hooks ×1 and closure ×1 per project | pass, nothing ran |
| `selected` | `src/math.mjs` | same, once each | pass, 2 files ran |
| `selected-again` | same branch, second run | same, once each | pass |
| `dynamic-only` | `src/extra.mjs` only | same, once each; "no test Squeal runs loads src/extra.mjs" | incomplete, exit 3, gap `no-loader` |
| `worktree-vitest-unrelated` | linked worktree, Vitest configured, CI-only change | same, once each; "Vitest: no test file to run" | pass |

A template specifier with a static prefix (`` import(`../src/${name}.mjs`) ``)
gave no closure note in an earlier run of the probe: the graph resolves it. The
issue's files use other forms; the probe keeps the fully computed one.

## Findings

**Q1, Q2. One emission per project.** `openRunners`
(`src/core/code/gate/runners.ts:108`) opens one adapter per `nodeTest`
project with the gate's `note`, which writes `squeal code: <text>` to stderr
(`src/cli/code-gate.ts:193`). `openProject`
(`src/runners/node-test/adapter-project.ts:66-90`) emits the preload notes
and the closure note through `once`, a per-adapter `Set` of texts, at open
and again on `invalidate`; an equal text never prints twice from one adapter.
The second adapter set the gate builds, the store keyer's `daemonAdapters`
(`src/cli/code-gate-stored.ts:146-181`), passes no `note`, so
`createNodeTestAdapter` uses `() => {}` (`src/runners/node-test/adapter.ts:67`);
the 0.1.443 bundle matches (`daemonAdapters` at `dist/cli/squeal.mjs:86284`,
no `note`). `collectEvidence` is called once (`code-gate-stored.ts:70`); the
`timed` proxy and `preparedBefore` open nothing. The PATH launcher imports
the CLI once (`~/.local/bin/squeal`, `import(pathToFileURL(cli).href)`).

**Q3. Not determined.** Candidates the evidence cannot separate: the
reporter's harness (Cursor inside Squawk) repeated stderr; two invocations were
pasted as one; or a store-read path the probe did not reach. The probe's
fixture had no store (`selected-again` still reported "no stored duration"),
so the store branch is covered by source reading only. The issue gives the
repeat as a paraphrase, "(the same four lines printed a second time)", not a
verbatim copy. Deciding it needs the reporter's raw stderr, or one run of the
same command in that worktree with `2>file`.

**Q4. The note does not scope to the change.** `notes()` runs inside
`openProject`, before `select` (`collect.ts:157-158`). It counts
`graph.incompleteClosures()` over every listed test file and names the first
3 (`NAMED_INCOMPLETE`, `adapter-project.ts:40`), then `", ..."`. In the
`unrelated` case the note named `test/math.test.mjs`, which the change did
not select. The spec's pre-run lines (020 D14.4) list file counts by group
and unloadable changed paths; they say nothing of closure gaps.

**Q5. The gap can matter, and fails toward incomplete.** `select`
(`collect.ts:219-250`) uses `adapter.affected(paths)`, the static graph
(020 D3.1). Observed runtime loads enter keys (011 C12), not the gate's
selection. In `dynamic-only`, the change to `src/extra.mjs`, loaded only by
the computed `import()`, selected no test; the gate said no test loads it and
read its changed function `incomplete` (`no-loader`), exit 3. So for a changed
function the verdict does not pass silently. For a changed path with no counted
function that only a computed import loads, the gate would select nothing and
nothing would mark it: inferred from `select` and D3.1, not run.

**Q6. Not in JSON.** The report's top-level keys are `format, createdAt,
versions, base, head, budget, scope, functions, omitted, uncounted, runs,
verdict, counts`; none holds closure gaps or preload hooks. `runs[]` is per
runner, not per project: with both projects selecting `test/math.test.mjs`,
stderr said "2 test files to run" and `runs[0].selected` listed the path once.

**Q7. The key.** `PolicyInputs` is `readonly string[] | Record<string,
readonly string[]>` (`src/core/types/policy.ts:243`), the top-level `inputs`
of 001 D11: "extra closure globs for fixtures read at runtime, either a list
applied to every test file or a map from test-file glob to input globs"
(`policy.ts:63-68`). The adapter reads `policy.inputs` for every project
(`runners.ts:113`). The issue's guess, "the project's `inputs` entry", is not
a key that exists.

## Recommendation for Squeal

- Do not plan a dedup fix from this issue alone. Ask the reporter for raw
  stderr from one run (`squeal code --base origin/main --json 2>gate.err`)
  before a duplicate-emission repair is approved; source and probe show no second path in 0.1.443.
- The scope gap is real and small: after `select`, tell how many of the
  project's incomplete-closure files the change selected ("0 of 19 selected"),
  and put the full list per project in the gate JSON. That is a 020 D7/D14.4
  question for the spec, with 003's closure note as the source of the list.
- Make the hooks note name the key: top-level `inputs` in `squeal.config.json`,
  a glob list or a test-glob map.

## Open questions

- The reporter's stderr (Q3).
- Whether a no-function change reached only by a computed import passes
  without a run (Q5, inferred). One more probe case decides it.
- Whether `runs[]` should split node-test projects (Q6 observation; outside
  this issue).

## Sources

- hearsay-tools/squeal#193, read with `gh issue view 193` on 2026-11-12.
- `src/runners/node-test/adapter-project.ts:40,66-90`,
  `src/runners/node-test/graph/preload-notes.ts`,
  `src/runners/node-test/adapter.ts:60-77`, `src/core/code/gate/runners.ts:67-120`,
  `src/core/code/gate/collect.ts:131-250`, `src/cli/code-gate.ts:88-215`,
  `src/cli/code-gate-stored.ts:25-181`, `src/core/types/policy.ts:63-68,243`,
  at `e5e3ba77c`.
- `docs/specifications/020-quality-gate/spec.md` D3.1, D14.4.
- 0.1.443 bundle: `~/.claude/plugins/cache/hearsay/squeal/0.1.443/dist/cli/squeal.mjs`.
- Probe and results: `research/probes/issue-193/`.
