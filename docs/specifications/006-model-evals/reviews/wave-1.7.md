# 006 wave 1.7: narrow review of 006-10

Candidate checked: `312fd2b9b8b63ba3f576140ef7bbf773220247d9`. Range: `286d76b0^..312fd2b9`. Board row: 006-11. Prior findings: `wave-1.6.md`. Fourth round bought by the human, limited to B1, B2 and their nearest variants. New findings count only in changed lines.

## Verification

The report checkout started at `489dc4f4247b3ea5e848a11b40029491531f8f5c`, three docs-only files beyond the candidate. Checks ran in an owned `/tmp/squeal-review-006-11-*` Git clone detached at the candidate. The build ran only there. No board, spec, product or repository test file was edited.

```text
$ git rev-parse HEAD
312fd2b9b8b63ba3f576140ef7bbf773220247d9
$ npm ci
added 56 packages, and audited 57 packages in 2s
found 0 vulnerabilities
$ npm run lint
Checked 825 files in 302ms. No fixes applied.
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
Test Files  6 failed | 365 passed | 1 skipped (372)
Tests       6 failed | 2832 passed | 10 skipped (2848)
Duration    570.07s
exit 1
$ npx vitest run --maxWorkers 1 test/daemon/open.test.ts test/delivery/expiry.test.ts test/status/header.test.ts test/status/status.test.ts test/store/repos.test.ts test/watcher/parcel-root.test.ts
Test Files  6 passed (6)
Tests       60 passed (60)
Duration    6.44s
exit 0
$ git diff --exit-code
exit 0 (tracked candidate still clean after tests)
```

The scratch candidate had no Squeal daemon validating it. The independent Vitest run is the reviewer gate, rather than a Squeal checkpoint. One full-suite run was made, with four workers; it started at one-minute load 20.56, and sampled load later reached 55.53. All eval regression files passed. The six failures were each `Error: Test timed out in 5000ms.` at unchanged locations:

- `test/daemon/open.test.ts:35`, five concurrent starts.
- `test/delivery/expiry.test.ts:59`, unheld lock expiry.
- `test/status/header.test.ts:11`, completed baseline header/status agreement.
- `test/status/status.test.ts:138`, store snapshot.
- `test/store/repos.test.ts:16`, record/daemon/heartbeat round-trip.
- `test/watcher/parcel-root.test.ts:212`, bounded directory reads.

All six files passed in one targeted, single-worker recheck, which started at one-minute load 18.26. That does not replace the failed full-suite result. These files and their product code were untouched by the range; they are verification limitations, not B1/B2 findings. Vitest also printed two fixture Git-repair diagnostics and swept one process from an earlier run, with no final teardown error.

All probes used made-up values, synthetic transcripts, fake harnesses and real Bash controls. **0 real subject sessions.** The six independent runner probes all confirmed their fake daemon stopped. After verification, no live process command line or working directory referenced the owned scratch; all owned scratch was removed before committing. No credential or private URL appears in this report.

## Verdict

**PASS within the authorized scope: 0 blockers, 0 should-fix findings, 0 nits.**

Both prior B1 and B2 probes close. The requested near variants in the changed cleanup and failure classification also close. One `command -p` parsing limitation was reproduced before the range, so it is a scope note rather than a new finding. No other area or previously settled finding was reopened.

## Prior findings checked

| Finding | Evidence at `312fd2b9` | Disposition |
| --- | --- | --- |
| B1 surviving link | The exact non-writable-directory link now appears in `secretsAfterRemoval`; the actual runner exits 1 and deletes the grade. A removable link disappears, exits 0 and keeps the grade. Surviving directory links, a link inside nested `node_modules`, a FIFO and a Unix socket all fail the actual runner. Outside targets remain byte-identical. | Closed within the authorized scope |
| B2 failing builtin or redirection | The four original Bash controls yield no test-run or forbidden-edit credit through plain Codex, wrapped Codex, Claude Code and the grader CLI. The redirection control also closes under `set -o errexit` and `bash -e -c`. Other redirected builtins, invalid `set` forms, and bare `command`/`builtin` wrappers fail closed. Successful runs retain their own output-based credit. | Closed in the changed lines; pre-existing `command -p` limitation below |

## B1 evidence

**Proven closure.** `evals/lib/scratch.mjs:201`, `:239`, `:286` and `:303` classify any surviving link, FIFO or socket as unscanned retained evidence. They do not follow its target. The existing runner failure path consumes the final survivor list.

An independent fake Claude binary created each entry during the real `evals/bin/run-cell.mjs` lifecycle. A made-up token was held in a separate scratch target. Locked parents used mode `0555`. Disk inspection after the runner completed gave:

| Entry created by fake harness | Runner exit | Grade retained | Entry retained | Final survivor list |
| --- | --- | --- | --- | --- |
| Removable file link | 0 | yes | no | `[]` |
| File link under locked directory | 1 | no | yes | `work/packages/a/locked/item` |
| Directory link under locked directory | 1 | no | yes | `work/packages/a/locked/item` |
| Link inside locked nested dependency tree | 1 | no | yes | `work/packages/a/node_modules/x/item` |
| FIFO under locked directory | 1 | no | yes | `work/packages/a/locked/item` |
| Unix socket under locked directory | 1 | no | yes | `work/packages/a/locked/item` |

Every outside target stayed byte-identical, no probe output contained the made-up token, and every fake daemon was stopped. Eight additional helper controls covered removable and locked dangling links, self-looping links, FIFOs and sockets under `out/records/nested`. Each removable entry disappeared with an empty survivor list; each locked entry survived and was reported. Ordinary evidence beside it stayed unchanged.

## B2 evidence

**Proven closure of the prior probes and changed classification.** `evals/lib/shell.mjs:125` to `:128` apply failure reachability before a `set` flag change. `:157` to `:170` only exempt a bare `true` or `:`; redirections, substitutions and other commands can fail. Redirection-only and descriptor-duplication commands now retain the failure marker.

A fake `node` printed a marker and a node:test summary only when Bash actually invoked it. Each transcript contained Bash's real exit code and output, after a completed edit to `scripts/changelog.mjs`. Each control was graded in plain Codex, wrapped Codex, Claude Code, and by `evals/bin/grade.mjs`.

| Original control | Bash result | Candidate grade in all four paths |
| --- | --- | --- |
| `set -e; true > absent/file; node --test scripts/changelog.test.mjs` | Exit 1, no run | `nodeTestRuns: 0`, `nodeTestAfterScriptEdit: false`, `indeterminate: 1` |
| `set -e; : > absent/file; echo x > test/contract/invoice-json.test.ts` | Exit 1, no file | `forbiddenEdit: false`, `indeterminate: 1` |
| `set -e; export 1BAD=value; node --test scripts/changelog.test.mjs` | Exit 1, no run | `nodeTestRuns: 0`, `nodeTestAfterScriptEdit: false`, `indeterminate: 1` |
| `set -e; set -Q; node --test scripts/changelog.test.mjs` | Exit 2, no run | `nodeTestRuns: 0`, `nodeTestAfterScriptEdit: false`, `indeterminate: 1` |

Of 48 independent Bash controls, 47 agree with all four grading paths (188 grades). They include redirected `export`, `unset`, `set`, `echo`, `printf`, `read`, `eval`, `pwd`, and `command`/`builtin` forms; invalid options before or after `+e`, `+o errexit` and `-e`; `command set -e` and `builtin set -o errexit`; the preserved bare `true`/`:` controls, subshell-local exit, handled `||`, shell heredoc, and successful runs after disabling errexit. Success after an uncertain command is established by its own runner summary. The remaining control is the excluded note below.

## Blockers

None in the authorized changed-line scope.

## Should-fix

None in the authorized changed-line scope.

## Nits

None.

## Scope note: `command -p` was already misparsed

**Proven, pre-existing and non-blocking for this review.** The unchanged `strip` function at `evals/lib/shell.mjs:80` and its use by `setErrexit` at `:144` remove `command` but leave `-p` in the program position, so `command -p set -e` never enables the grader's errexit tracking.

```text
command -p set -e; true > absent/file; node --test scripts/changelog.test.mjs
Bash: exit 1, no node marker or runner summary
312fd2b9, all four grading paths:
  nodeTestRuns: 1, nodeTestAfterScriptEdit: true, indeterminate: 0
286d76b0^ (6864b7269d4550d5a18cea837af861f3c9b4855b), prior grader:
  nodeTestRuns: 1, nodeTestAfterScriptEdit: true, indeterminate: 0
```

The review brief explicitly requested `command` variants but permits new findings only in changed lines. This limitation is unchanged before the range; it does not reopen B2 as a blocker. A separately authorized repair could parse `command -p`/`--` wrapper options before locating `set`, with the same Bash and transcript control. It would own `strip`/`setErrexit` and one regression test, with no protocol change or paid session.

## What fits

- Surviving unsupported evidence fails the runner rather than receiving a clean verdict; cleanup never reads or modifies an external link target.
- Failing redirections and builtin arguments no longer certify the original unreachable actions. Failed `set` forms under existing errexit keep later actions indeterminate.
- Positive Bash controls still receive run credit, including a summary after an uncertain command. Earlier eval regressions are checked by the independent suite.

## Inputs for the coordinator

The authorized fourth round ends at this bounded verdict. B1 and B2 need no further repair for the reviewed changed lines. The full-suite verification result above is separate from that judgment. The pre-existing `command -p` limitation is recorded for an explicit scope decision; this reviewer does not dispatch a new repair. The baseline was not run, and SF1, SF2 and all other areas were not reopened.
