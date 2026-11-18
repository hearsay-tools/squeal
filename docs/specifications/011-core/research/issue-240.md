# Issue 240: excluded TS copies and test scheduling

2026-11-18. [Issue #240](https://github.com/hearsay-tools/squeal/issues/240).
Recommendation: keep the incident open for bounded diagnosis of its stored inputs;
the isolated no-reader case did not reproduce on installed Squeal 0.1.550.

## Answers

| Question | Answer and evidence tag |
|---|---|
| Does creating/deleting 120 excluded TS files with no test closure create revisions or runs? | **Verified by experiment, 0.1.550:** no, in two fresh-fixture variants, each with two add/delete rounds. A third intermediate repeat agreed. Revision stayed 0; keys and run counts stayed unchanged; no queued or running test remained in any snapshot. |
| Is this only because ignored inputs are never watched? | **Verified by experiment, 0.1.550:** no. Editing a static-imported ignored control or an observed runtime-read ignored control made revision 2 with `ignored:true` and reran only its reader. The tracked control first made revision 1. |
| Do the scratch files have runtime or listing readers despite having no static imports? | **Verified by experiment, 0.1.550:** not in these fixtures. Stored closures contain only the two tests, their snapshots and their respective source inputs. The runtime variant's `observed.` map names only `packages/pkg/src/known.ts`; no scratch file or directory listing is present. No declared inputs or import globs are configured. |
| Does this settle the reporter's 238-file queue and “not listed” wait? | **Inferred, limited to 0.1.550:** no. The incident's config, runner versions, shared observed sets, closures, revision rows and runner-refinement state were not captured here. “No test imports them” does not exclude observed reads, environment inputs or listings. |

## Experiment and commands

Installed launcher: `~/.codex/plugins/data/squeal-hearsay/bin/squeal` (resolved
absolutely by the probe), `--version` returned **0.1.550**. Node **v26.13.0**,
Vitest **5.0.3**, Linux, **24 CPUs**. Initial preflight `cat /proc/loadavg`
returned `0.84 0.36 0.18 1/738 2314482`; `getconf _NPROCESSORS_ONLN` returned `24`.
Probe start load1 was 0.36 for the static control and 0.19 for the runtime control;
their snapshot ranges were 0.36–0.52 and 0.19–0.37. The intermediate repeat began
at 0.29. Live reproduction was permitted by the load limit.

Commands run from the checkout:

```sh
gh issue view 240 --repo hearsay-tools/squeal --json title,body,url
node --disable-warning=ExperimentalWarning docs/specifications/011-core/research/probes/issue-240/probe.mjs > docs/specifications/011-core/research/probes/issue-240/output.jsonl
OBSERVE=1 node --disable-warning=ExperimentalWarning docs/specifications/011-core/research/probes/issue-240/probe.mjs > docs/specifications/011-core/research/probes/issue-240/output-observed.jsonl
```

The first output was renamed `output-static.jsonl`. The second command was run
once with a static control, then again after making its control a runtime read;
the intermediate output is `output-observed-static-control.jsonl`. The README
records these small probe changes. Runtime observation was enabled in all three:
initially by the default, then explicitly. Early progress incorrectly described
the default as false; the installed source default and final findings correct it.

Each probe initializes a fresh nested Git repository under its ignored
`.fixture-*` directory, links existing dependencies without changing them,
commits its fixture, then invokes:

```sh
squeal --version
squeal start
squeal run tests test/basic.test.ts test/known.test.ts --wait 30000
# After each scratch add/delete, with a four-second observation interval:
git check-ignore packages/pkg/src/lint-base/file-0.ts # after additions
squeal status --json
# After changing each genuine input:
squeal status --wait 10000 test/basic.test.ts
squeal status --wait 10000 test/known.test.ts
squeal stop
```

Here `squeal` denotes the absolute launcher above. The two named baseline tests,
status waits and cleanup commands exited 0. All fixtures were stopped and
removed. No existing daemon, hold or store was changed. No full repository suite
or dependency install ran. A read-only SQLite snapshot after every step records
`revisions`, `test_file_keys`, `runs`, `test_files` and observed/glob meta rows.

| Step | Static control: revision / total runs | Runtime control: revision / total runs |
|---|---:|---:|
| Baseline | 0 / 1 | 0 / 2 |
| Add 120 excluded TS files, round 1 | 0 / 1 | 0 / 2 |
| Delete those files, round 1 | 0 / 1 | 0 / 2 |
| Add 120 excluded TS files, round 2 | 0 / 1 | 0 / 2 |
| Delete those files, round 2 | 0 / 1 | 0 / 2 |
| Edit tracked `value.ts` | 1 / 2 | 1 / 3 |
| Edit ignored reader input `known.ts` | 2 / 3 | 2 / 4 |

**Verified by experiment, 0.1.550:** every scratch-step `git status --porcelain`
was empty, and `git check-ignore` confirmed the new scratch path was ignored.
Both tests remained current with unchanged keys. Runtime baseline uses two runs
because its newly observed ignored input is incorporated before a stable result.
The control revisions name only their genuine input, never the scratch copy.

## Source evidence and limits

**Read in source code, tag `squeal--v0.1.550` at `9b8583f2a`:**
`src/core/watcher/candidates.ts` filters batch candidates through `checkIgnored`,
except known extra files; it also checks files found while walking a directory.
`src/core/watcher/git.ts` uses `git check-ignore -z --stdin`. This agrees with
the experiment. C2 requires ignored known inputs to be watched, C3 keys closures
and listings, C4 queues changed keys and tracks runner refinement, and C12 keeps
observed ignored inputs subject to its written-directory bound. Blanket exclusion
would remove a legitimate invalidation path that the control demonstrates.

**Read in repository findings and board, checkout `34ea37ce6`:**
[`issue-105-findings.md`](issue-105-findings.md) (0.1.352) also found no scratch
revision; its actual incident was an ignored runtime descriptor with 32 readers.
The original [`issue-105.md`](issue-105.md) had skipped live reproduction due to
load. Board row 011-270, released in 0.1.388, removes a path from the extra-file
set when Git stops ignoring it; that is a different condition. These are related
evidence, not proof that #240 has the same cause. Existing holds, including the
dropped 016-25 listing proposal, remain unchanged.

**Inferred recommendation, bounded by these measurements:** before changing
ignore rules, capture the incident's changed-path rows, matching closures and
observed/listing/environment inputs, plus whether files remain queued behind
runner refinement. This distinguishes a genuine no-reader admission defect from
a retained input or a separate listing stall. This research authorizes no fix.

Not determined: behavior with the original lint process, shared worktree history,
the reporter's runner version, a two-minute copy lifetime, concurrent backlog,
restarts or macOS. Four-second snapshots do not sample every transient phase;
unchanged revision/key/run history is the stronger evidence here. Linked installed
dependencies caused a pnpm-lock mismatch note and package-metadata fallback in
each fixture; the note stayed unchanged, and the positive controls still passed.
The fixture validates the strict no-reader case, not the original incident.

Sources: issue URL above; spec [C2/C3/C4/C12](../spec.md); amendment
[log](../status.md); [probe and normalized evidence](probes/issue-240/README.md);
tagged source at
<https://github.com/hearsay-tools/squeal/tree/squeal--v0.1.550/src/core/watcher>.
