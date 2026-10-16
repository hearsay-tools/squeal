# Issue #16: missing build prerequisites in the slow tier

Treat #16 as corroborating #3's prerequisite problem, retaining its new recovery
and provenance evidence; no implementation is authorized.

Research date: 2026-10-16 UTC (2026-10-17 Warsaw). Target installed Squeal
**0.1.199**, Node **v24.21.0**, git **2.43.0**, Linux, 24 available CPUs.
Repository sources/specs read at `63c2f9abde46b97e978bb1171303c8d716e0b689`
(`package.json` version 0.1.203).
Bounded documentation-only investigation; the live reproduction was **not
reproduced because the mandatory launch load check refused it**. No inference
below is a new successful reproduction.

## Questions and verdicts

| # | Question | Answer and evidence tag |
| --- | --- | --- |
| 1 | Does installed 0.1.199 reproduce #16 through an explicit slow request? | Not determined in this run: load 24.17 exceeded 24 CPUs before launch. **verified by experiment**, load gate and CLI version only, 0.1.199. |
| 2 | Does a built-first control pass? | Not determined here: control skipped under the same load decision. Prior #3 research records missing-output failure and built-first success on 0.1.199. **inferred**, from that retained experiment, not repeated. |
| 3 | What do D5-D9 currently guarantee? | Artifact keying, constrained inheritance and provenance, with policy-dependent Stop; they do not promise to build or gate on a build prerequisite. **read in source code**, spec/status at `63c2f9ab`. |
| 4 | Is “declared artifact unknown for 3” a missing-build detector? | No: the current implementation counts missing recorded artifact provenance. Its cause in #16 is not determined. **read in source code**, `63c2f9ab`; no 0.1.199 runtime verification here. |
| 5 | Duplicate overlap and new information? | Same missing-output prerequisite problem as #3; #16 adds an identified repository/head, explicit slow request, a reported 40-minute delay and build-only recovery. **inferred**, issue snapshots read 2026-10-16, both describing 0.1.199-era behavior. |

## Commands and observed output

Issue text fetched with `gh issue view 16 --repo hearsay-tools/squeal --json
number,title,body,url,comments` and the equivalent for #3 without `comments`.
Exact JSON responses are preserved in `probes/issue-16/issue-{16,3}.json`.

Version checks (all exit 0):

```text
$ node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs --version
0.1.199
$ node --version
v24.21.0
$ git --version
git version 2.43.0
```

Initial reads found load 22.39, then 21.64, below 24 CPUs. The deciding check was
inside the script immediately before any scratch directory or daemon creation:

```sh
SQUEAL_CLI=/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs sh docs/specifications/004-slow-suites/research/probes/issue-16/run.sh > docs/specifications/004-slow-suites/research/probes/issue-16/missing.txt 2>&1
```

```text
{"at":"2026-10-16T22:59:16.062Z","load1":24.17,"cpus":24,"eligible":false}
[shell exit 3]
```

Output is retained as `probes/issue-16/load-gate.txt` (the exit code is the shell
tool's result). The script compares `os.loadavg()[0]` with
`os.availableParallelism()`. We did not wait for a favorable sample or retry.
**Cleanup:** no probe scratch directory, store, socket, slot or daemon was
created; none needed stopping. No repository build or broad suite ran.
Documentation checks: `sh -n .../probes/issue-16/run.sh` and staged
`git diff --cached --check` exit 0; the three evidence JSON files parse.

The prepared, unexecuted adaptation reuses #3's unchanged dependency-free fixture:
three slow files import `dist/index.js`, spawn `dist/cli.mjs`, and check the
declared package `bin`. `dist/` is ignored and declared through
`inputs: {"test/e2e/*.test.mjs": ["dist/**"]}`. It replaces #3's full checkpoint
with `run --slow --wait 60000`, then a named-file wait for all three files. The
built-first control would run only the fixture's copy/write `scripts/build.mjs`
before startup. These paths remain unverified here.

## Prior evidence, duplicate overlap and limits

**Inferred from retained research, Squeal 0.1.199:** `issue-3-preconditions.md`
records four failures across three slow files with missing `dist/`: a file-level
module-load failure, a missing bin, a CLI exit-code assertion and an empty-output
regex assertion. Its built-first control records zero failures; building after
the failure re-keyed the files and produced `FAIL -> PASS`. Both initial cases
used `run --all --wait`, so this is evidence for the prerequisite mechanism, not
a fresh verification of #16's explicit slow command.

**Inferred from the issue report, not independently verified:** #16 identifies
cezarion PR #1142, head `53a1a3e81`, Squeal revision 7, missing
`packages/cezar/dist/` and `packages/cezar/web/dist/`, 38 failures across 10 package
test files, and 37 change-affected files already current and passing. It reports
roughly 40 minutes behind a shared slot. Its recovery comment says:

> “then Squeal revision 8 reran the 13 affected package test files. All 38 pre-build failures cleared.”

The same comment reports 91/91 slow files current and zero failures after
`npm run build`, without source changes. This strengthens the missing-build
explanation and gives a named original incident, which #3 lacked. It does not
independently prove the timing, CI result or which three files had unknown
artifact provenance. No original cezarion checkout, retained store or CI run was
examined, and the 40-minute suite was deliberately outside scope. The tiny probe
also isolates XDG runtime/slot state and cannot measure that contention.

**Inferred, duplicate assessment:** #3 already requests declared preconditions,
one clear unmet-precondition result and coverage of both paths. #16 requests
the same core capability, now explicitly accepting configured guidance without
automatic builds. Preserve #16's recovery, concrete head, delay and skill-policy
interaction as additional evidence rather than treating it as an unrelated
failure family. Whether either issue should be closed is the coordinator's
decision.

## Contract and open questions

**Read in source code, `63c2f9ab`:** D5 keys declared artifacts; D6 requires an
existing declared non-test artifact for cross-worktree inheritance, but permits
reuse within the worktree. `src/core/slow/inherit.ts:18` implements that rule;
`src/core/scheduler/slow-tier.ts:554` emits a note for missing artifact matches.
D7 names slow policy keys, not a build prerequisite. Goal 8 explicitly says
“Squeal never builds anything.” D8-D9 govern provenance and completion policy.
The installed 0.1.199 skill's step 4 requires the slow request before completion;
the later 004-62 amendment, shipped in 0.1.202 per `status.md`, makes guidance
depend on `stop.requireSlowSuite`. That text correction does not itself address
missing generated artifacts.

**Read in source code, `63c2f9ab`:** `src/core/state/slow.ts:151` increments
`artifactUnknown` when the stored artifact record is absent;
`src/core/state/slow-text.ts:98` renders the partial “unknown for N” clause. This
is distinct from D5's unmatched-artifact note. Do not infer that exactly three
build directories were missing from #16's header.

**Inferred recommendation:** group the prerequisite concern with #3 and retain
an explicit not-run/unknown boundary in any later decision, consistent with the
vision's honest provenance and bounded autonomy. No automatic build is justified
by this research. Existing holds remain unchanged. Still open: live explicit
slow/control behavior, the original missing provenance records, partial/stale
build handling, and the policy/result semantics of any future prerequisite.

## Sources

- [Issue #16](https://github.com/hearsay-tools/squeal/issues/16), including [recovery comment](https://github.com/hearsay-tools/squeal/issues/16#issuecomment-6224164084); fetched snapshots above.
- [Issue #3](https://github.com/hearsay-tools/squeal/issues/3); `issue-3-preconditions.md` and `probes/issue-3-preconditions/` at `63c2f9ab`.
- `../spec.md` D5-D9, goal 8; `../status.md` 004-62; `docs/vision.md` principles 1, 2, 5, 8.
- Installed `0.1.199/skills/squeal/SKILL.md` step 4 and `references/commands.md`; installed CLI path above. Source-code claims are pinned separately to the repository commit, not assumed identical to the installed bundle.
