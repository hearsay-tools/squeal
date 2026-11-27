# Issue 298: file timing in status

2026-11-27. Recommendation: keep this as a proposed read-only timing query improvement, with the meaning of “last” decided before implementation.

## Verdict and scope

**Partial reproduction of [#298](https://github.com/hearsay-tools/squeal/issues/298).** The three reported surface behaviors reproduce on installed **0.1.654**, using existing results for this repository's `test/bench/deps.test.ts`: selected-file status omits duration, a bare file query returns `found: false`, and an exact check query returns `durationMs`. The reporter's 0.1.647 installation and `scripts/readers.test.mjs` were not available here. No tests, benchmark, fixture runner, or full suite were started. This was a result-query experiment, not a measurement of test performance.

Source checkout: `9a55a53a4ae5c976702c1a0957c2354537db3e62`. Initial `cat /proc/loadavg` and `nproc` returned `1.85 2.50 3.88 1/1510 2559368` and `16`; the saved probe rechecked load at `1.21484375` against 16 CPUs. Both were below the brief's gate.

| Question | Answer and evidence |
| --- | --- |
| Does selected-file status expose duration? | **Verified by experiment, 0.1.654:** no duration field in the current/pass row. **Read in source code, checkout above:** `NamedFileEntry` and `fileEntry` omit it. |
| Is bare `why <file>` unable to find stored timings? | **Verified by experiment, 0.1.654:** it returns five candidates with duration summaries, but `found: false`. Project-qualified file lookup succeeds. The timings exist; the bare query is ambiguous. |
| Does exact check lookup expose duration? | **Verified by experiment, 0.1.654:** yes, both the file-level identity and a test identity return stored `durationMs`. |
| Is this already one command for last file time plus slowest checks? | **Read in source code, checkout above:** the inspected status/why surfaces do not provide that combined answer. Candidate summaries are capped at 20 and are historical aggregates, not a slowest-check ranking for one file run. |

## Commands and observed output

The launcher was `~/.codex/plugins/data/squeal-hearsay/bin/squeal`; `--version` printed `0.1.654` (exit 0). Commands below abbreviate that path as `squeal`. The throwaway [probe](probes/issue-298/read.py), its [README](probes/issue-298/README.md), and [saved output](probes/issue-298/output.txt) preserve exact argv, exit codes and selected JSON fields. Output is deliberately projected, not a full CLI transcript; home prefixes are normalized to `~`.

**Verified by experiment, 0.1.654.**

```sh
squeal status --json test/bench/deps.test.ts
```

Exit 3. `selection.testFiles` was exactly:

```json
[{"project":"isolated","path":"test/bench/deps.test.ts","state":"current","verdict":"pass"}]
```

The overall selection was `result: "none", reason: "unsynced"`, despite the stored file row being current/pass. This is evidence of the row's shape, not a successful synchronized completion verdict. No duration was present.

```sh
squeal why --json test/bench/deps.test.ts
```

Exit 1, `found: false`, five candidates (one file and four tests). `candidateDurations` was present. The file candidate's summary was:

```json
{"results":3,"pass":3,"fail":0,"skip":0,"minMs":88.13113200000001,"medianMs":89.916145,"p95Ms":119.370455,"maxMs":119.370455}
```

```sh
squeal why --json '[isolated] test/bench/deps.test.ts'
squeal why --json "[isolated] test/bench/deps.test.ts > the bench project's pinned dependencies > pins vite exactly beside vitest and @vitest/coverage-v8"
```

Both exited 0 with `found: true`. Their first stored result durations were respectively `88.13113200000001` and `32.310143` ms. The first test result was a historical **fail**, while status's stored selected-file verdict was pass. Both first result rows named producer worktree `5dbfa4ce83e7fc7c`, revision 10, dirty commit `e5b251a7ce4ee7e59eab6f00956fb4bf5952bc3c`, run `7bee8962-bb94-473f-a787-5f449cf64f67`. These are stored history, not evidence of a run in this research worktree or necessarily of its current selected key.

## Why the surfaces differ

**Read in source code, checkout above.** `src/cli/named-print.ts:148` maps the selected files through `fileEntry`; `src/cli/named-file-lines.ts:256` defines the row and `:278` constructs it without timing. This explains the selected-file omission for both snapshot and named-wait JSON.

**Read in source code, checkout above.** `src/core/state/check-name.ts` parses a bare path as a file-level check in the default project (`""`). `src/core/status/why.ts:81` first tries that exact identity, then searches known check names. Here the actual project is `isolated`; the bare path matched the file and its tests, so the ambiguity answer at `:145` returned `found: false`. Prefixing `[isolated]` supplied an exact file identity. This explains this reproduction; the reporter's project configuration was not inspected.

**Read in source code, checkout above.** `why.ts` caps ambiguous candidates at 20 and uses `durationsOf` over stored results per candidate. `src/core/status/durations.ts` calculates min, nearest-rank median/p95 and max over passes and failures, excluding skipped durations. These summaries do not identify the most recent single run's slowest tests. `src/core/types/runner.ts:555` also distinguishes optional reported file duration from the fallback sum of test cases, so file duration and sum of check times must not silently become interchangeable.

## Decision input and limits

**Inferred from the experiment and source above.** There is enough evidence for a timing-discoverability proposal under 011 C5/C6/C7/C14/C15. Existing project-qualified `why` can retrieve a file's stored timing today. A combined query still needs a definition of “last”: result at the selected key, newest completed run here, or newest shared historical result. It also needs to state whether slowest checks belong to that same run or a historical aggregate, how many are shown, and what absent or pruned timings mean. The historical fail beside a current/pass selection makes that distinction concrete.

Original node:test file behavior and 0.1.647 remain unverified. The `unsynced` snapshot was not diagnosed; no retries or new validation were requested. No claim is made that this worktree's full suite passed.

This report authorizes no implementation and preserves all holds. In particular, **gh-118 remains held until a second report requests its selected-key/run provenance scope**. A request to see timing does not approve that row or its run-start history feature.

## Sources

- [Issue #298](https://github.com/hearsay-tools/squeal/issues/298), reported reproduction supplied in the research brief.
- [011 spec](../spec.md), C5/C6/C7/C14/C15, and [amendment log](../status.md).
- Source paths and checkout cited above; [saved experiment output](probes/issue-298/output.txt).
- `docs/board.md`, gh-118's explicit hold. Duplicate triage belongs to the parent coordinator.
