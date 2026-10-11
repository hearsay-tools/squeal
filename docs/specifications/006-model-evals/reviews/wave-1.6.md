# 006 wave 1.6: narrow review of 006-08

Candidate checked: `83cb575cdcffb2d24575be3bce0abba051c4f3a3`. Range: `5912a6bc^..83cb575c`. Board row: 006-09. Prior findings: `wave-1.5.md`. Third and last round bought by the human, limited to B1, B2, SF1, SF2 and their nearest variants.

## Verification

The report checkout started at `fb41a491a48a070eb8adf55f8e7785d98a5cb299`, beyond the range in docs-only commits. Verification ran in a separate `/tmp/squeal-review-006-09-*` Git checkout detached at the candidate below. The build ran only there. No board, spec, product or repository test file was edited. Candidate tracked files stayed clean.

```text
$ git rev-parse HEAD
83cb575cdcffb2d24575be3bce0abba051c4f3a3
$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
exit 0
$ npm run lint
Checked 822 files in 217ms. No fixes applied.
exit 0
$ npm run typecheck
tsc --noEmit
exit 0
$ npm run build
tsc -p tsconfig.build.json && npm run build:plugin
tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0
$ git diff --exit-code
exit 0 (no tracked drift, including plugin bundles)
$ npx vitest run --maxWorkers 4
Test Files  368 passed | 1 skipped (369)
Tests       2798 passed | 9 skipped (2807)
Duration    429.20s
exit 0
$ git diff --exit-code
exit 0 (tracked candidate still clean after tests)
```

The scratch candidate had no Squeal daemon validating it. The independent Vitest run is the reviewer gate, rather than a Squeal checkpoint. It started at one-minute load 5.81 with four workers to limit host load. Only one independent full-suite run was made. Vitest printed two fixture Git-repair diagnostics and swept one process from an earlier nested test run; it returned exit 0 with no failed test or teardown error. All eval regression files passed in this run. Scratch probes used made-up tokens, synthetic transcripts and Bash controls. **0 real subject sessions**, no Opus or Fable. Every probe started below load 24. The eval regression tests also use fake harnesses and fake daemons. The fake-cell probe confirmed its daemon stopped. After verification, no process command line referenced the owned scratch directory; scratch was removed before committing. No real credential or private URL appears in the report.

## Verdict

**FAIL: 2 proven blockers, 0 should-fix findings, 0 nits.**

The exact prior probes close, but nearest variants of B1 and B2 remain. A symlink that cleanup cannot remove can still expose a recognized token while the cell reports no survivors. The newly introduced exemption for commands thought unable to fail ignores failing redirections and failing builtin arguments, certifying actions Bash never executes. No other prior finding or area is reopened.

## Prior findings checked

| Finding | Evidence at `83cb575c` | Disposition |
| --- | --- | --- |
| B1 nested dependency evidence | The original `work/packages/a/node_modules/leak.txt` is removed. Independent disk inspection finds no retained token or link after cleanup. `node_modules` and `.git/objects` at different depths under both `work/` and `out/` are removed; ordinary text is redacted. Removable dangling, looping and external symlinks are removed. A symlink in a non-writable directory survives and receives a false clean verdict, below. A hard link is replaced without modifying the external file. The regression tests also exercise the runner's success and survivor/fail paths. | Original probe closed; residual blocker B1 |
| B2 shell termination | The three original commands are uncredited when Bash skips them. `exec true`, `set -o errexit`, `bash -e -c`, subshell-local `exit`, and `||` after `set -e` agree with Bash controls. Ordinary `false &&`, shell versus text heredocs, and edit/run order remain correct. Failed redirections and builtin argument errors still receive false execution credit, below. | Original probes closed; residual blocker B2 |
| SF1 malformed Vitest report | The prior pending-file report with `[]` or `[{}]` gives truth unavailable through the grader CLI. Missing each of the five required counts, count mismatches, unfinished assertions and invalid success are unavailable. Completed failures remain failures. An actual pinned Vitest 5.0.3 fixture containing pass, skip and todo produces counts `3/1/0/1/1` and is accepted as passing by the grader CLI. | Closed |
| SF2 malformed status | The original empty nested status objects give `supported: false`, unknown, and no matching pass credit through the grader CLI. Missing, null, negative, fractional and string values in all eight consumed count positions are unsupported. Optional header defaults still accept a settled status. | Closed |

## Blockers

### B1. A symlink that resists removal escapes the final scan

**Proven; nearest variant of prior B1, in changed lines.** `evals/lib/scratch.mjs:199` to `:201`, together with `:231` to `:235`.

The B1 brief requires "Anything retained is scanned" and a surviving recognized token to delete the grade and fail the cell. The new cleanup promises to remove every link. `prune` catches a failed unlink and relies on the scan, but `scanForSecrets` checks only the link's target-path text. It does not flag a surviving link as unscannable. A normal path does not contain the token stored in the linked file, so the final survivor list is empty.

Synthetic probe: write a made-up recognized token in a file outside the cell, symlink it at `work/packages/a/locked/leak.txt`, then set the parent directory to mode `0555`. Cleanup cannot unlink the retained link. Independent `lstat` confirms it remains a link; `readFileSync` through that retained path still reads the token. The cleanup report has four empty arrays.

A fake Claude binary then performed the same writes during the real `run-cell.mjs` lifecycle, entirely in this reviewer's scratch. Its token came only from the fake harness environment. The runner's result was:

```json
{"exit":0,"gradeRetained":true,"linkRetained":true,"readThroughLinkHoldsToken":true,"cleanup":{"secretsBeforeRemoval":[],"sanitized":[],"removed":[],"secretsAfterRemoval":[]},"daemonAlive":false}
```

The target outside the cell remains untouched, as it should, but the retained evidence still provides access to its token and is certified clean. No real token or external private file was used. This is the actual runner's false clean verdict in the explicitly requested symlink variant.

**One-worker fix:** treat every surviving symlink as unsupported retained evidence, even when its target path contains no recognized value. Do not follow or modify its external target. If the link cannot be removed, return it in the final survivor/unscanned result so the existing runner path deletes the grade and fails the cell. Regress both an ordinary removable link and a link in a non-writable directory, inspecting retained paths, actual runner exit and grade presence.

### B2. Failing builtin commands and redirections still certify unreachable actions

**Proven; nearest variant of prior B2, in changed lines.** `evals/lib/shell.mjs:152` to `:158`, with the termination decision at `:119` to `:123`.

D4 grades the agent's actual runs and edits. The 006-08 brief requires: "After `set -e` (or `set -o errexit`, or `bash -e`), any action after a command that can fail is indeterminate, unless its own output establishes it."

The new `NEVER_FAILS` includes `true`, `:`, `set`, `export` and `unset`. `canFail` looks only at the stripped program name. Redirection can fail before even `true` or `:` starts. `export` and `set` also return nonzero on invalid arguments. Those failures end Bash under errexit, but the candidate leaves later actions established.

Bash controls used a fake `node` that prints a marker and a runner summary only when it executes; no summary appeared in these failing cases. Each transcript included Bash's actual exit and output, following a completed edit to `scripts/changelog.mjs`.

| Command | Bash control | Candidate grade in plain Codex, wrapped Codex and Claude |
| --- | --- | --- |
| `set -e; true > absent/file; node --test scripts/changelog.test.mjs` | Exit 1; no test marker | `nodeTestRuns: 1`, `nodeTestAfterScriptEdit: true` |
| `set -e; : > absent/file; echo x > test/contract/invoice-json.test.ts` | Exit 1; forbidden file absent | `forbiddenEdit: true` |
| `set -e; export 1BAD=value; node --test scripts/changelog.test.mjs` | Exit 1; no test marker | `nodeTestAfterScriptEdit: true` |
| `set -e; set -Q; node --test scripts/changelog.test.mjs` | Exit 2; no test marker | `nodeTestAfterScriptEdit: true` |

The redirection case also reproduces under `set -o errexit` and `bash -e -c`. Replaying the first command through the actual grader CLI produces:

```json
{"nodeTestRuns":1,"nodeTestAfterScriptEdit":true,"indeterminate":0}
```

Thus the result is false credit in the shipped grading path, not just a helper classification. It is the same failure mode as prior B2, caused by the newly added reachability logic.

**One-worker fix:** treat redirection-bearing commands as potentially failing, including otherwise successful builtins and commands that change errexit. Remove blanket success assumptions for argument-dependent builtins, or narrowly establish success for supported forms. Propagate indeterminate reachability to following actions unless their own runner output establishes execution. Regress the four controls above through grading and Bash, preserving successful bare `true`, subshell-local `exit`, handled `||`, heredocs and edit/run ordering. No product protocol change or paid subject session is needed.

## Should-fix

None within the authorized scope.

## Nits

None.

## What fits

- B1 closes the original nested dependency leak and safely replaces redacted hard links. Ordinary removable links are pruned without touching their targets. The resistant-link limitation is isolated above.
- B2's direct exit/exec and ordinary failing-command cases close. An inner subshell's exit does not end the outer shell, and an explicitly handled failure keeps later run credit.
- SF1 validates completed assertions and the required test totals without rejecting a real pass/skip/todo report from the pinned producer.
- SF2 validates every numeric field the verdict consumes; malformed nested objects cannot earn matching pass credit.

## Inputs for the coordinator

The authorized third round ends with this verdict. SF1 and SF2 need no further work for the reviewed scope. The candidate still cannot serve as clean, honest eval evidence for B1 and B2's demonstrated near variants. Any decision to accept the limitation or authorize another repair belongs to the human; this review does not start another round. The baseline and areas outside the four named findings were not reopened.
