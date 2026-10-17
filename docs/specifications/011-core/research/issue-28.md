# Issue 28: volatile failure text read as `FAIL -> FAIL, failure changed`

Researcher, 2026-10-17, against the brief `issue-28-brief.md`. Documentation-only reproduction, bounded to about 20 minutes. Nothing here is a design; the spec owner decides.

Versions and host: checkout `ab67f040` (package `0.1.204`); installed `squeal --version` `0.1.199` (`~/.local/bin/squeal`); Node v24.21.0. One-minute load 19.54 at start and 19.02 at the last check, on 24 CPUs (`uptime`, `nproc`), so below the CPU count. Live probes were allowed by load; the full two-worktree reproduction was left out for time, not load (Q3).

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Do the issue's two port-looking messages share a fingerprint? | No. Nothing in `VOLATILE` matches a bare decimal port, so `35321` and `34963` stay and the fingerprints differ: `fail-changed`. | verified by experiment, checkout `ab67f040` |
| 2 | Do the issue's two Squeal-tmp paths share a fingerprint? | No. `/tmp/squeal-1001` becomes `<tmp>` and `6db45f9b91a3d272` becomes `<hex>`, but the `mkdtemp` suffix `QI9brD` / `jzfwcE` survives. With the daemon's TMPDIR equal to one worktree's scratch directory, that worktree's path collapses fully and the other worktree's does not, so they still differ. | verified by experiment, checkout `ab67f040` |
| 3 | Does an inherited same-key result with no new revision deliver `FAIL -> FAIL, failure changed`? | Not reproduced, because a two-worktree daemon run (npm ci, two daemons, one store) did not fit the 20-minute budget. The code paths that would deliver it are named under Q3; that part is read in source, not observed. | read in source code, checkout `ab67f040` |
| 4 | Do the controls behave? | Same raw message: same fingerprint. Changed assertion value (`to be 2` vs `to be 3`): different. Changed path tail (`cli.js` vs `main.js`): different. Durations and ISO times: same. | verified by experiment |
| 5 | Is the raw message kept apart from the fingerprint, for `squeal why`? | Yes by spec and schema: failure text is stored deduplicated by exact text, the fingerprint is a separate derived column. Not run here. | read in official docs (spec 011 C7); read in source code (`src/core/store/repos/results.ts:97-159`) |
| 6 | Does installed 0.1.199 have the same fingerprint logic? | Likely. The last commit to `fingerprint.ts` is `2f459e49` (2026-10-15), before 0.1.199. No release tag was found locally to confirm it. | inferred |

## Findings

**Q1 and Q2, fingerprint evidence (direct).** `describeFailure` (`src/core/state/fingerprint.ts:94`) builds the fingerprint as `<name>: <normalize(first line)> @ <path:line:col>`. `transitionKind` (`src/core/state/transitions.ts:25`) returns `fail-changed` on any string inequality. `VOLATILE` (`fingerprint.ts:27-39`) masks ISO times, `N ms`, `0x` addresses, `node_modules/.cache` paths, the first segment below each temp prefix, UUIDs, and hex runs of 16 or more characters that contain a letter. It has no rule for ports, pids or a `mkdtemp` suffix in a later path segment. Probe output, default TMPDIR (`/home/agent/projects/squeal/.ai/cezar/t/1168dfbb`):

```
A port (issue): DIFFERENT fingerprint (fail-changed)
  1: AssertionError: expected '... 127.0.0.1:35321' to match /port 35321.*(in use|occupied)/ @ test/serve-port.test.ts:42:7
  2: AssertionError: expected '... 127.0.0.1:34963' to match /port 34963.*(in use|occupied)/ @ test/serve-port.test.ts:42:7
B squeal tmp + mkdtemp (issue): DIFFERENT fingerprint (fail-changed)
  1: ... open '<tmp>/tmp/<hex>/cez-installed-workers-QI9brD/packages/cezar/dist/cli.js' @ ...
  2: ... open '<tmp>/tmp/<hex>/cez-installed-workers-jzfwcE/packages/cezar/dist/cli.js' @ ...
```

The `/tmp` rule's lookbehind `(?<![\w.-])` runs against the original string in one pass. It therefore masks only `/tmp/squeal-1001`; the inner `/tmp/` follows `1` and is kept. With `TMPDIR=/tmp/squeal-1001/tmp/6db45f9b91a3d272`, the longest prefix wins: path 1 becomes `<tmp>/packages/cezar/dist/cli.js` and path 2 is unchanged as above. In that case even one daemon fingerprints the two worktrees' copies of a failure differently.

*Which TMPDIR a daemon sees (inferred).* The prefixes are computed once, when the module loads (`const VOLATILE` calls `tempPrefixes()`). The daemon sets its own scratch TMPDIR later, at runtime (`adoptScratch`, `src/core/daemon/daemon.ts:134`, `scratch.ts:187`). With static imports, a daemon's prefixes are therefore the spawning hook's TMPDIR plus `/tmp`, not its scratch directory, so the default-TMPDIR run above is the representative one. This was not observed in a live daemon.

The message bodies in the probe are reconstructed. The issue quotes only the fragments that changed (the regex with the port, the path), so the surrounding words are illustrative. The result depends only on those fragments.

**Q3, inherited path (read in source, not reproduced).** The fingerprint compared is the one stored on the result row, computed by the daemon that ran it (`derive.ts:90-92` uses `result.fingerprint` and recomputes only when it is null). A worktree with no new revision can take another worktree's newer row under the same key in two ways:

- `storeResults` (`src/core/scheduler/store-results.ts:36-51`). When a run in worktree Y flips any check of a file to `pass`, it calls `sink.refresh` for every other worktree X whose current key for that file is the same, at X's latest revision. Every check of that file is refreshed, so a still-failing check whose message differs only by a port or tmp path gets X's state replaced with Y's fingerprint.
- X's own `sink.refresh` of changed rows (`ledger.ts:513`), and lookup hits for X's own runs, which can take a row Y wrote. A `run --all` checkpoint is one such case. Which of these produced the issue's notification at "revision 4" is not determined, because no store from that run was examined.

In either path, `transitionKind(prev, next)` sees `fail -> fail` with unequal strings. X's consumers then get `FAIL -> FAIL, failure changed` (`delivery/provenance.ts:20`) with no edit in X. A plain fail-over-fail in Y alone does not refresh X (`store-results.ts:37`: no flip to pass, return). That narrows when the issue's case can arise, but it does not rule the case out.

**C5's guarantee and open question 9.** Spec 011 C5 says normalization exists "so a re-run of the same failure never reads as a changed one". Open question 9 records a random temp path in the first line as "the noisy case… a changed failure on every re-run" and proposes normalizing UUIDs and temp paths. Q1 and Q2 show that this guarantee does not hold for ephemeral ports or `mkdtemp` suffixes below a nested temp path, so issue 28 is a C5 conformance gap, not new behaviour.

## Recommendation for Squeal

The fingerprint half of issue 28 is reproduced directly: both of the issue's pairs read as changed failures at `ab67f040`. The controls show that the current rules keep genuinely changed values distinct. Whatever masks ports and `mkdtemp` suffixes has to keep the D and E controls distinct, which rules out stripping all digits or whole paths.

The decision belongs to the spec owner. One option is to fingerprint against volatile tokens in the message (port after `:` or `port `, a `-XXXXXX` mkdtemp tail, all temp-prefix segments). Another is to compare by the receiving worktree's last-told fingerprint, as the issue's second bullet suggests. The inherited-delivery half needs a live two-worktree probe before anyone claims it from this file.

## Open questions

1. A live two-worktree reproduction (shared store, two daemons, a test that fails with a fresh port per run) to observe the inherited `fail-changed` with no new revision, and which of the two paths in Q3 fires.
2. Whether the module-load timing of `tempPrefixes()` in a bundled daemon matches the inference above (log `tmpdir()` at load in a live daemon).
3. Whether 0.1.199 is byte-equal for `fingerprint.ts` (needs the release tag or the installed bundle's source).

## Commands and sources

- Probe, repository root: `node --import ./docs/specifications/011-core/research/probes/issue-28/ts-hooks.mjs docs/specifications/011-core/research/probes/issue-28/fingerprint-probe.mjs`. Again with `TMPDIR=/tmp/squeal-1001/tmp/6db45f9b91a3d272`. Exit 0 both times. No `npm ci`, daemon or store.
- Issue: https://github.com/hearsay-tools/squeal/issues/28 (`gh issue view 28 -R hearsay-tools/squeal`, 2026-10-17).
- `status.md`: no entry names issue 28, the fingerprint or normalization (grep, 2026-10-17), so no amendment overrides C5 here.
- Spec 011 C5 (normalization, transitions, inherited confirmation), C6, C7 (failure text versus fingerprint column), open question 9: `docs/specifications/011-core/spec.md`.
- Source at `ab67f040`: `src/core/state/fingerprint.ts`, `src/core/state/transitions.ts`, `src/core/state/derive.ts`, `src/core/scheduler/store-results.ts`, `src/core/scheduler/ledger.ts:513`, `src/core/daemon/scratch.ts`, `src/core/daemon/daemon.ts:134`, `src/core/delivery/provenance.ts:20`.
