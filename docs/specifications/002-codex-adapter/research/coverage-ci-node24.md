# Node 24 coverage CI comparison (002-42)

Recommend a bounded spec 015 repair of node:test source-map ingestion. Preserve child coverage exclusion. The failures follow Node 24.22.1's lazy source-map parsing, on both main and the Codex candidate. They are real mapping and source-text provenance defects, not assertions to relax.

Research: 2026-10-27, within the 20-minute bound. Product, tests, generated files and shared docs were not edited. Evidence and throwaway probes: [coverage-ci-node24/](probes/coverage-ci-node24/README.md).

## Questions answered

| Question | Answer and evidence tag |
| --- | --- |
| Candidate regression or runtime change? | **Verified by experiment**, Node 24.21.0 and 24.22.1: both commits pass 7/7 on the former and fail the same two assertions on the latter. |
| Test assumption or fixture race? | **Verified by experiment**: isolated, sequential fixtures reproduce wrong line mapping and the exact replacement blob. A control without Squeal reproduces the source-map change. A shared-fixture race is not needed to explain either failure. |
| Why do both assertions fail? | **Read in source code**, both installed Node versions and both Squeal commits: Node now defers map parsing after Squeal deletes `NODE_V8_COVERAGE`. Squeal treats `data: null` as an untransformed file, despite the inline map URL still being present. |
| Does the payload preserve original text? | **Verified by experiment**: decoding its inline URL in a payload copy restores 3/4 coverage and the original blob after the source was replaced. No disk source is needed. |
| Repair owner and boundary? | **Inferred** from the probes and spec 015 D8: the coverage owner should handle this payload form and reject unusable transformed-source evidence. The Codex adapter delta is not the cause. |

## Exact comparison

**Verified by experiment.** Main `40259a9e48f76a6fd5fd128c6e6efb37bcbf771e` and candidate `9401c1d083df042fe85a44d66d73495515bf0ebe`, Linux x86_64. Both detached scratch worktrees used the installed dependencies: Vitest 5.0.3, tsx 4.23.15, esbuild 0.28.2. Their lockfiles and coverage source/test paths have no diff. That equality supports the controlled comparison; it is not the causal proof by itself.

For each tree and each `V` in `24.21.0 24.22.1`:

```sh
PATH=/home/agent/.nvm/versions/node/v${V}/bin:$PATH \
  pnpm exec vitest run test/runners/node-test/coverage.test.ts \
  --maxWorkers=1 --reporter=verbose
```

| Commit | Node | Result | Vitest duration |
| --- | --- | --- | --- |
| Main `40259a9e4` | 24.21.0 | Exit 0; 7 passed | 3.44 s |
| Main `40259a9e4` | 24.22.1 | Exit 1; 5 passed, 2 failed | 3.36 s |
| Candidate `9401c1d08` | 24.21.0 | Exit 0; 7 passed | 3.34 s |
| Candidate `9401c1d08` | 24.22.1 | Exit 1; 5 passed, 2 failed | 3.59 s |

The two failures match [CI 40513866109, job 122222539571](https://github.com/hearsay-tools/squeal/actions/runs/40513866109/job/122222539571): `area` receives 4/4 instead of 3/4 at line 219; the edit-before-map assertion at line 249 receives `2f833eedad2b85b5e3dad64fd1b0776863b60da4` instead of `619c64d849227598d84b34b98604bab17e631d1b`. The fetched CI log confirms Node 24.22.1 and totals of 2 failed, 571 passed, 4 skipped. Only the relevant log excerpt is preserved.

Direct checks were explicitly authorized for this runtime comparison. The worktree's Codex hook installation failed before launch because the plugin was absent. Dependencies and focused runs worked without setup changes. No daemon result or full-suite pass is claimed. No build, lint or product typecheck was needed for this research-only change.

## Causal proof

**Read in source code**, installed Node 24.21.0 versus 24.22.1: `internal/source_map/source_map_cache`, extracted from `process.binding("natives")`; the complete module diff and binary SHA-256 values are preserved. In `maybeCacheSourceMap`, 24.21.0 eagerly calls `dataFromUrl`. Version 24.22.1 instead writes:

```js
data: process.env.NODE_V8_COVERAGE ? dataFromUrl(filename, sourceMapURL) : undefined,
```

Its exit serialization uses `v.data ?? null` and retains `v.sourceMapURL` when data is absent. Its new `sourceMapData` function can parse the map on demand, but the test's normal execution does not request it.

**Read in source code**, both Squeal commits: `src/runners/node-test/runtime/recorder.cjs` removes the matching coverage variable at the test entry, after preloads. This lets tsx initialize with coverage enabled while keeping the variable out of test code, child processes and user worker threads. `src/core/code/coverage/own.ts` then calls `asRun` when cached map data is null. `asRun` reads current disk bytes and maps V8 offsets as if those bytes were executed without a transform.

**Verified by experiment**, both commits and runtimes: `probe.mts` uses the real adapter, captures the selected payload, maps it, replaces `src/edited.ts`, and maps again. Fixture source text, hashes, V8 ranges, map entries and records are preserved in `payload-*.json`.

- Node 24.21.0: each of the three fixture map entries has parsed `data`, including original `sourcesContent`; `url` is null.
- Node 24.22.1: each entry has `data: null` and a `data:application/json;base64,...` URL. That URL still contains the original source text and mappings. Line lengths are preserved.
- The `area` ranges are identical: outer function `[114, 161)` count 1; unexecuted branch `[140, 150)` count 0. Its generated first line is 274 characters. These are transformed-code offsets, not original TypeScript offsets.
- Mapping the newer payload unchanged gives `area: ran=true, 4/4` and `neverCalled: ran=true, 1/2`. The older payload gives `area: ran=true, 3/4` and `neverCalled: ran=false, 0/2`.
- After the edit, the newer payload gives the replacement blob. The original and replacement bytes are exactly those in the regression test, not newly chosen hash examples.

**Verified by experiment**, independent of Squeal: `control.mjs` starts Node with `NODE_V8_COVERAGE` and tsx, then either keeps the variable or deletes it before dynamically importing a TypeScript source. Both versions retain parsed map data when the variable stays. Only 24.22.1 loses parsed data when it is deleted. Thus neither the adapter implementation nor Vitest's fixture sharing is required to reproduce the map-cache change.

The same control starts a child. Keeping the variable exposes it to that child and produces three coverage payloads. Deleting it hides it and produces one. Restoring or retaining the variable is therefore not an acceptable repair by itself. The original focused adapter tests also pass the child exclusion and worker-variable assertions on both runtimes.

## Provenance and malformed maps

**Verified by experiment**, all four adapter probe cells: decoding the inline URL into `data` in a *copy of the captured payload*, then calling the unchanged `ownRecord`, restores `area: 3/4`, `neverCalled: untested` and the original blob `619c64d849227598d84b34b98604bab17e631d1b`. This occurs after disk holds `export const nowEdited = 1;\n`. The map's text is sufficient provenance. This is an input experiment, not a product repair or a tested implementation.

Replacing the decoded `sourcesContent` with `[null]` gives no source records and lists all three fixture sources as `unread`, as D8 requires. Conversely, setting `data` to null with either a missing URL or a malformed inline JSON URL makes today's mapper use disk bytes, including the replacement blob. Those synthetic variants are recorded under `mapVariants`. The current mapper does not parse or validate the URL at all.

**Inferred recommendation:** distinguish known transformed code with unusable map evidence from genuinely untransformed files. A malformed map, missing original text, mismatched source identity or unsupported map location must not silently become a current-disk record when the payload indicates a transform. Preserve the existing plain-source path where no transform is indicated. Do not read an external map from disk later and call it run-time provenance without proof.

## Bounded repair recommendation and limits

Assign the repair to spec 015's node:test coverage owner. Start with `src/core/code/coverage/own.ts`, its cached-map input type, and focused own-map/adapter regressions. Accept a valid inline map retained in the payload, preserve the executed source text and generated line lengths, and report unusable transformed-source evidence as `unread`. Keep the recorder's child exclusion contract. Review provider/key version requirements when the mapper's meaning changes. Do not weaken the two assertions or treat unchanged candidate coverage files as a CI waiver.

The smallest next implementation check is a red-first mapper case built from the preserved 24.22.1 payload: null parsed data plus valid inline URL, then missing text, malformed URL and source-identity variants. Re-run the focused adapter tests on both installed Node 24 versions and the supported Node 22 floor. Validate the actual mapping worker as well as direct mapping. This research does not validate a parser implementation, external map files, arbitrary URL encodings, resource bounds or a final stored/status result after an edit.

Scratch fixture directories and both detached worktrees were removed. Probe subprocesses exited and adapters closed. No product repair was made.

## Sources

- Installed Node sources: `/home/agent/.nvm/versions/node/v24.21.0/bin/node` and `v24.22.1/bin/node`, `process.binding("natives")["internal/source_map/source_map_cache"]`; extraction commands in the probe README.
- Both pinned commits: `src/runners/node-test/runtime/recorder.cjs`, `src/core/code/coverage/own.ts`, `src/core/code/coverage/map.ts`, `test/runners/node-test/coverage.test.ts`.
- Spec 015 D8 and `docs/specifications/015-coverage-complexity/reviews/0.1.358-r3.md`: prior repair passed Node 24.21.0 and Node 22.19.0/22.23.3; original-text provenance and child exclusion are existing requirements.
- [Preserved commands and evidence](probes/coverage-ci-node24/README.md), including the CI excerpt, four test logs, four adapter payload observations and two controls.
