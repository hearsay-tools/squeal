# Issue 140: oxlint's five-second guard

Investigate discovery timeouts before changing the lint-part budget.

**Verdict:** partial synthetic reproduction on Squeal **0.1.392**. An oversized
provider call times out and subsequent parts succeed. The real first pass already
uses 16-file parts and succeeds on the same fixture. The reported whole-repository
lint call and a cold-only effect are **not reproduced**. The issue's top-level
`failed` field points to failed key discovery, which is a different path.

## Questions and answers

| Question from the brief | Answer and evidence tag |
|---|---|
| 1. Does a whole-set call exceed the fixed guard? | **verified by experiment, 0.1.392 / oxlint 1.90.0:** a deliberately supplied 32-file call returns 32 unknown results after 5,010 ms. Direct oxlint completes in 6,514 ms. |
| 2. Do subsequent parts succeed? | **verified by experiment, same versions:** two 16-file calls complete in 3,345 and 3,365 ms, with zero unknown results. The seeded finding is retained. No restart occurs. |
| 3. Is this cold-only, or the real pass's first-call behavior? | **verified by experiment, same versions:** another 32-file call times out at 5,013 ms. A fresh real pass calls `inputs(32)`, `lint(16)`, `lint(16)` and succeeds. Cold-only behavior is not established. |
| 4. Why could every file become unknown? | **read in source code, 0.1.392:** discovery uses `--debug files` in chunks of 256. A discovery exception reaches `failKeying`, which marks every candidate with a prior state unknown and writes the top-level `failed` reason. |
| 5. What explains the original incident and restart recovery? | **inferred, reported 0.1.392:** the quoted `failed` field is consistent with discovery timing out. Which child timed out, its arguments, its scheduling delay and the effect of restart are **not determined**, because the issue has no child trace and this fixture did not reproduce them. |

## Evidence and commands

Run on 2026-11-03. Initial one-minute load: **12.85 on 24 CPUs** (the parent's
16.55 was an earlier reading). Successful probe phase gates ranged from **6.11 to
6.80**, always below 24. Each phase checked load before starting. No full suite,
external-project edit, installation or daemon restart was used.

```sh
gh issue view 140 --repo hearsay-tools/squeal --json title,body,comments,url
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
git rev-parse 'squeal--v0.1.392^{commit}'
git hash-object /home/agent/.claude/plugins/cache/hearsay/squeal/0.1.392/dist/cli/squeal.mjs
git rev-parse 'squeal--v0.1.392:plugins/claude-code/dist/cli/squeal.mjs'
node --disable-warning=ExperimentalWarning research/probes/issue-140/probe.mjs
node --check research/probes/issue-140/probe.mjs
```

The installed bundle and release tag both have blob
`f5eb36f0a519712fe5c806f6e94878ff46f88099`. The release commit is
`56764d5455ddae8e9090a6492dc3959574d13cc9`. Runtime: Node **v24.22.1**;
oxlint **1.90.0**; oxlint provider version **1**. The probe exports the unchanged
provider and pass from a disposable bundle copy instead of invoking CLI `main`.
The harness supplies disk listings and an isolated lint store. It does not run the
daemon, its watcher, capacity pool or CLI presentation layer.

**verified by experiment, 0.1.392 / oxlint 1.90.0:** the fixture has 32 small JS
files and one JS plugin rule. Each file waits 200 ms in rule creation using
`Atomics.wait`; one identifier triggers a finding. This is finite synthetic delay,
not a benchmark of the original project. The probe contains the exact child
argument construction, including all 32 paths. Preserved output:

| Call | Wall time | Observed output |
|---|---:|---|
| `provider.open()` | 120 ms | oxlint 1.90.0, provider 1 |
| `provider.inputs(32 paths)` | 113 ms | 32 inputs |
| `provider.lint(32 files)` | 5,010 ms | 32 unknown; `timed out after 5 s` |
| `provider.lint(first 16)` | 3,345 ms | 1 finding, 15 clean, 0 unknown |
| `provider.lint(last 16)` | 3,365 ms | 16 clean, 0 unknown |
| `provider.lint(32 files)` again | 5,013 ms | 32 unknown; same reason |
| Direct CLI, all 32 paths | 6,514 ms | exit 1, `number_of_files: 32`, one `probe(slow)` finding |
| Fresh real pass | 6,913 ms | stored 31 pass, 1 fail; calls `inputs(32)`, `lint(16)`, `lint(16)` |
| Same pass after fixing the file | 461 ms | stored 32 pass; calls `inputs(1)`, `lint(1)` |

The experiment proves the guard counts elapsed time even for finite work that
would finish. It also proves that total pass duration can exceed five seconds
without failure when each child finishes within the guard. It does not prove
that a normal first pass supplies a whole repository to `lint()`.

## Source trace and limits

**read in source code, 0.1.392:** `provider.ts` sets `guardMs` to `5_000`.
`spawn.ts` starts that timer for each child and kills its process group on expiry.
`run.ts` returns `timed out after 5 s` and maps a failed lint call to unknown results.
There is no separate cold-start allowance for oxlint. D3's 60-second ESLint start
budget does not extend D11's oxlint child budget.

**read in source code, 0.1.392:** `parts.ts`, `PART_FILES` and `nextPart`, cap actual
lint calls at 16 on the first pass as well as later passes. `rekey.ts:inputsOf`
asks for the candidate inputs before these parts. `run.ts:lintedFiles` chunks that
request at 256, with one five-second guard per `--debug files` child. It stops on
the first failure. This is not one guard over the sum of all discovery chunks.

**read in source code, 0.1.392:** `rekey.ts:failKeying` writes `failedKey` and turns
prior candidate states unknown. `surface/snapshot.ts:reasonsOf` reads this key
into `failed`. A successful keying clears it. Normal lint-part timeouts do not
write this key. With no prior states, `failKeying` does not create unknown rows
for every candidate. Thus the reported 2,279 unknown rows and `failed` reason
fit a failed keying over existing states. They do not establish that one lint
execution contained 2,279 files. These source files are unchanged between the
release and examined checkout `719bd678fe72e340daf68fe1e3af775f2031c0db`.

**inferred, 0.1.392:** the direct 8,732 ms run reported in the issue measures lint
execution, so it cannot by itself explain a discovery timeout. A fresh process is
used for every oxlint part; "subsequent" does not mean a retained warm worker.
Restart could change load, caches or stored work, but this experiment does not
separate those effects. The original project, its 10 rules, 2,279-file set and
restart sequence remain outside the reproduction. No official-doc claim is used.

## Recommendation and proposed done-when

Keep this as a bounded discovery and recovery investigation. The deciding
tradeoff is allowing finite work to finish while retaining a guard against a
stuck plugin. The evidence does not select a larger timeout, a load formula or
a state-semantics change. Existing D2/D9 make a terminated attempt unknown;
files merely awaiting work remain pending. Any change to that rule needs a
spec decision. Lint stays off by default; type-aware oxlint and all other holds
remain unchanged.

Proposed done-when for an approved follow-up:

- A trace identifies the timed-out operation (`--print-config`, `--debug files`
  or `--format json`), path count, elapsed time, version and load.
- A controlled cold pass and config re-key reproduce the relevant timeout with
  a real JS plugin. The selected policy then reaches correct violation and fix
  results without a daemon restart, with current-byte provenance preserved.
- Genuine stalls still terminate within the approved bound; unknown results
  never become passes or keyed successes. Pending work and terminated work
  remain distinct. Existing three-failures-in-ten-minutes behavior is checked
  against the approved policy.

Open questions: the original timed-out child and argv; why discovery exceeded
five seconds; whether a nudge without restart would recover; and what policy the
human wants if legitimate single-part startup itself exceeds the guard.

## Verification

The probe completed with exit 0. `node --check` and the scoped command
`pnpm exec biome check research/probes/issue-140/probe.mjs research/probes/issue-140/observations.json`
returned 0 (Biome retained one informational template-literal suggestion).
Local links resolve. The affected-status command was:

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 research/probes/issue-140/probe.mjs docs/specifications/017-lint-checks/research/issue-140.md
```

It returned exit 3: neither path belongs to a test-file closure; worktree known
failures 0, all 1,385 test files current at revision 21. This is no selected-test
verdict and no new full-suite run. Squeal labels probe functions untested because
Vitest does not load this standalone research script; the explicit probe run is
its evidence. No product code, board, spec, status or skill changed.

## Sources

- [Issue #140](https://github.com/hearsay-tools/squeal/issues/140), fetched with
  `gh` above. Its timings are reporter observations, not independently verified.
- [Released source](https://github.com/hearsay-tools/squeal/tree/56764d5455ddae8e9090a6492dc3959574d13cc9/src/core/lint):
  `provider/oxlint/{provider,run,spawn}.ts`, `pass/{parts,rekey}.ts`,
  `surface/snapshot.ts`. Read locally and checked against the tag; the installed
  bundle matches its committed release blob.
- [Spec](../spec.md), D2/D3/D7/D9/D11, and [decisions](../status.md), read at
  checkout `719bd678`; these are policy sources, not runtime proof.
- [Throwaway probe](../../../../research/probes/issue-140/probe.mjs),
  [instructions](../../../../research/probes/issue-140/README.md), and
  [recorded output](../../../../research/probes/issue-140/observations.json).
