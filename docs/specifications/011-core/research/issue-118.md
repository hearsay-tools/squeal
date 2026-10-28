# Issue 118: selected status entries lack key and run provenance

Recommend an observability proposal under 011 C6/C15 and 005 D2. The missing
fields are confirmed on 0.1.370. No scheduler or runtime-input failure is proven.
Existing holds stand. This research authorizes no implementation.

## Scope and verdict

Examined 2026-10-28, source commit `9e4206a2d72738d6964b955aa0dc7073796f4d15`,
package and installed CLI version **0.1.370**. The cheap probes completed between
11:44 and 11:47 UTC, within the 20-minute bound. No browser setup, runtime rewrite,
test run, full suite, daemon start, retry or hold change was requested.

| Question | Answer and evidence tag (0.1.370) |
| --- | --- |
| Q1. Does a selected entry expose the current key and held result revision? | No. Live UNKNOWN entry omits both; a source formatter probe of current/pass produces exactly the issue's four fields. **verified by experiment** |
| Q2. Can status count starts since a supplied revision? | No `runsSince` field in the selected entry; `--since-revision 0` exits 2 as an unknown option. **verified by experiment** |
| Q3. Are relevant facts available behind the CLI? | Current keys, result provenance and run records are stored separately. The selected-entry formatter does not expose them. **read in source code** |
| Q4. Was the original runtime rewrite/no-run incident reproduced? | Not determined. This probe did not access the reported Cezarion worktree, rewrite its runtime file or run its browser specs. Field absence is independent of that incident. **inferred**, from this probe's scope and the issue report |

## Experiments

**E1 — verified by experiment, 0.1.370.** Before the first live status read:

```sh
node -e 'const os=require("node:os");console.log(JSON.stringify({at:new Date().toISOString(),load:os.loadavg(),cpus:os.cpus().length,available:os.availableParallelism(),version:require("./package.json").version}))'
```

Output at `2026-10-28T11:44:25.069Z`: load `[19.57,16.44,15.61]`,
24 CPUs, 24 available CPUs, version `0.1.370`. The one-minute load was below
the CPU count. The saved probe checks again before each command; all four reads
ran at load **9.70947265625 / 24 CPUs**, at 11:46:37–11:46:38 UTC.

Exact repeatable command from this worktree's root:

```sh
python3 docs/specifications/011-core/research/probes/issue-118/probe.py > docs/specifications/011-core/research/probes/issue-118/evidence.json
```

The [throwaway probe](probes/issue-118/probe.py) records
each command's argv, cwd, load, time, exit code and output. Its
[evidence](probes/issue-118/evidence.json) retains the
complete selection and projects out unrelated global status data.
Its CLI commands were:

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --version
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --json test/cli/status-paths.test.ts
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --json --since-revision 0 test/cli/status-paths.test.ts
```

Version exited 0 with `0.1.370`. Status exited 3 at revision 2 with
`selection.result: "none"`, `selection.reason: "unsynced"`, a live daemon,
`runsOpen: 0`, and this exact selected entry:

```json
{
  "project": "",
  "path": "test/cli/status-paths.test.ts",
  "state": "unknown",
  "reason": "no result: never run at this key: the baseline is lookup-only, so nothing queued it",
  "next": "`/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal retry test/cli/status-paths.test.ts` runs it once",
  "command": "/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal retry test/cli/status-paths.test.ts"
}
```

`key`, `resultRevision` and `runsSince` are absent, not null or zero. The command
with the proposed flag exited 2 with:

```text
squeal status: unknown option "--since-revision"
```

**E2 — verified by experiment, source 0.1.370 at the commit above.** A synthetic
current/pass input to the actual formatter avoids creating a test result:

```sh
pnpm exec tsx -e 'import { fileEntry } from "./src/cli/named-file-lines.ts"; console.log(JSON.stringify(fileEntry({testFile:{project:"e2e",path:"packages/web/e2e/smoke.e2e.ts"},state:"current",verdict:"pass"},"squeal")))'
```

Exit 0, exact output:

```json
{"project":"e2e","path":"packages/web/e2e/smoke.e2e.ts","state":"current","verdict":"pass"}
```

This reproduces the reported output shape. It is not a live current/pass result.
A separate read in `/home/agent/projects/squeal` with E1's status argv exited 3:
revision 1159, daemon down, empty selection, and the named file not listed there.
That attempt adds no current-result proof. No daemon was started to improve it.

## Source findings and contract

**F1 — read in source code, 0.1.370.** `NamedFileEntry` and `fileEntry`
(`src/cli/named-file-lines.ts:215–264`) emit identity, state, optional verdict,
reason, next command and yield details. They emit none of the requested facts.
`src/cli/named-print.ts:136–151` maps this formatter into `selection.testFiles`
for both the snapshot and wait. A new `--wait` experiment is unnecessary and
could request work under C15. `why` reads a current key internally
(`src/core/status/why.ts:220,322`) but its return shape at lines 249–279 does
not expose that key as a dedicated current-key field. Result keys are historical
evidence; they are not a general replacement for the current scheduler key.

**F2 — read in source code, 0.1.370.** `src/core/store/schema.ts:68–76`
records the per-worktree current key and its revision. Lines 99–116 record each
result's key, producer worktree, revision and run ID. Lines 138–148 and
`src/core/store/repos/runs.ts:18–51` record a run's worktree, revision, selected
files and start time. `RunRepo.inFlight` reads only open runs; it does not count
all starts since a revision. `src/core/store/prune.ts:148–164` deletes eligible
unreferenced runs, so retained history is not an unlimited audit log.

**F3 — read in official docs, repository spec at the examined commit.**
011 C3 separates result provenance from input keys. C5 records known-state
revision and origin. C6 says status reads the store and reports uncertainty;
its 2026-10-20 amendment explicitly keeps a result current when its key has not
moved, even if observed at an older revision. C15 requires selected-file class
and known verdict, with `selection` shared by both forms. 005 D2 specifies named
selection and the snapshot's sync, and now permits a named wait to request one
run for an idle stale/unknown file. These sections do not currently promise the
three fields or a since-revision option. Treat this as an API capability gap,
not a proven breach of an existing field contract.

## Recommendation, limits and open questions

**R1 — inferred, from E1/E2 and F1–F3, 0.1.370.** Propose a read-only provenance
extension for human approval. It would remove the need for private SQLite probes.
The deciding tradeoff is a useful compact answer versus a zero count or revision
that claims more than the stored evidence proves. No product design is selected here.

The proposal must settle: whether “since” excludes the supplied revision or means
wall-clock starts after that revision; which worktree's starts count; tier starts
versus actual per-file execution; focused, cancelled and failed runs; and how to
report pruned history. For `resultRevision`, define which held result is meant,
how its producer worktree is identified, and what unknown, stale and withheld
inherited failures return. C3/C5 allow inherited provenance, so a producer's
revision is not automatically comparable to this worktree's revision.

**R2 — inferred, 0.1.370.** Neither an unchanged key nor `runsOpen: 0` proves
that nothing started between two reads. A completed run is no longer open.
The original issue reports Cezarion revisions 9–16 and direct database evidence;
those claims remain reported, not independently verified here. No real browser
fixture or current held-result age was reproduced. The formatter proof and live
UNKNOWN proof are sufficient for the bounded field-absence verdict.

Verification ran the probe only. Squeal reported 1,314 UNKNOWN test files in this
lookup-only worktree; no suite pass is claimed. It also flagged the throwaway
Python probe as untested/CRAP 56. The probe was executed directly; that static
coverage warning is not evidence of a product failure. No lint, build or typecheck
was needed for this documentation and throwaway-probe change.

Final check: `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status
--wait 60000 docs/specifications/011-core/research/issue-118.md
research/probes/issue-118/probe.py research/probes/issue-118/README.md
research/probes/issue-118/evidence.json` exited 3 at revision 4: no test file's
closure holds any changed path; 0 known failures, 1,314 UNKNOWN test files.
Python syntax and saved exit/output consistency checks passed.

The coordinator moved the captured probes from repository-root `research/probes/issue-118/`
to this spec's `research/probes/issue-118/` after collection. Commands above use
the final path; the final check records the worker's original paths.

## Sources

- [Issue 118](https://github.com/hearsay-tools/squeal/issues/118), fetched with
  `gh issue view 118 --repo hearsay-tools/squeal --json number,title,body,comments,url`;
  no comments at read time. Original report: 0.1.370, Claude Code under Cezar.
- [011 spec](../spec.md), C3/C5/C6/C15, and [amendment log](../status.md).
- [005 spec](../../005-agent-adoption/spec.md), D1/D2 and CLI/install context.
- [Pinned source tree](https://github.com/hearsay-tools/squeal/tree/9e4206a2d72738d6964b955aa0dc7073796f4d15);
  exact paths and lines are cited above.
- [Probe README](probes/issue-118/README.md) and saved E1/E2 evidence.
