# Spec 018 wave 5: the second slice

Approved by the human 2026-11-09 ("Design: Approve"; fetch only when the project sets `shared.ref`; trust bound is push access; cezar pins the latest Node 26.x). Rows 018-16, 018-18 and 018-19 run in parallel on disjoint seams; 018-17 starts after 018-16 fixes the part format; 018-20 after 018-17.

## 018-16 `squeal ci record`

Use /worker. Shape: slice.

Outcome: `squeal ci record [--out <dir>] -- <command>` runs the project's Vitest command unchanged, returns its exit code, and writes one part file per Vitest process with each test file's outcome, checks, duration, observed reads and each project's environment descriptor.

Read: `spec.md` D8, D9 (the consumer of your format), D1, D2; `research/ci-step.md` 1 to 3.

Starting seam: `src/runners/vitest/observe.ts` and `reporter.ts` (the daemon's recorder and reporter) and how `run.ts` attaches them; a fixture with two `--shard` runs as the first failing test. First edit offered as a lead: a runner-adapter entry point that attaches the recorder and a part writer to a command the user gives, with no daemon and no store. Define the part file format in `src/core/ci/parts.ts` with a version field and document it in your final message; 018-17 reads it.

Owns: `src/cli/ci.ts` (new, the `ci` command group), `src/cli/main.ts` (register `ci`), `src/core/ci/` (new), the Vitest adapter files the recorder attach needs, their tests.

Leave alone: `src/core/store/transfer*.ts`, `src/core/status/`, `src/core/keys/environment-descriptor.ts` (018-18); `src/runners/node-test/` (018-19). No coverage provider in this path. Other runners print "not supported" and run the command unchanged. No `pnpm run build`.

Done when: the two-shard fixture writes disjoint parts; exit codes pass through (pass, fail, crash); nothing is written outside `--out`; `squeal status --wait 60000 <changed paths>` current and passing; lint and typecheck clean.

## 018-18 import tolerance and re-key

Use /worker. Shape: slice.

Outcome: an export made with `CI=true` and a different observed union imports as current wherever the content is equal.

Read: `spec.md` D10, D11, D15; `research/ci-step.md` 3, `research/key-rules.md` 2 (option d) and its probes; `research/import-trial.md` count 2.

Starting seam: a failing test first: import the shape of the trial's case into a store whose observed union holds extra paths and whose environment differs only in `allowOnly`; the file must become current. First edit offered as a lead: `importResults` (`src/core/store/transfer.ts`) computes each file's local key from the local closure list, the export commit's blob ids (`git ls-tree -r <commit>`), and the local environment with D10's fields compared as equal, and stores the results at that key. D10's field rule lives in one function beside `describeDifferences` (`src/core/keys/environment-descriptor.ts`). Status adds "observed set differs" and the no-coverage note (D15).

Owns: `src/core/store/transfer*.ts`, `src/core/store/imports.ts`, `src/core/keys/environment-descriptor.ts`, `src/core/status/import*.ts`, `src/cli/import.ts`, their tests.

Leave alone: `src/cli/main.ts` and `src/cli/ci.ts` (018-16); `src/runners/` (018-16, 018-19); key inputs: no key of a local run may move. No `pnpm run build`.

Done when: D10 and D11 tests pass (each tolerated field; a browser-mode project still keyed; content differs means not current); `squeal status --wait 60000 <changed paths>` current and passing; lint and typecheck clean.

## 018-19 node:test keyed without a path

Use /worker. Shape: slice.

Outcome: node:test's environment keys the project's Node by `process.version`, `process.versions`, a hash of `process.config`, `platform` and `arch`, not by `execPath`.

Read: `spec.md` D12; `research/key-rules.md` 1 and its probes.

Starting seam: `src/runners/node-test/adapter-environment.ts` (about lines 70 to 74) and `version.ts`. First failing test: one Node build at two paths gives equal environments; two builds of one version (differing `process.config`) differ. Raise `NODE_TEST_ADAPTER_VERSION`, not `KEY_FORMAT_VERSION`.

Owns: `src/runners/node-test/`, its tests, the node:test validity case if the key-format alarm needs one.

Leave alone: every other runner and the core key inputs: Vitest and pytest keys must not move (`test/keys/key-format.test.ts` shows it). No `pnpm run build`.

Done when: the two tests pass; the key-format alarm moves only node:test cases; `squeal status --wait 60000 <changed paths>` current and passing; lint and typecheck clean.

## 018-17 `squeal ci export --parts`

Use /worker. Shape: slice. Starts from the coordinator's branch with 018-16, 018-18 and 018-19 integrated (release 0.1.420 in review).

Outcome: `squeal ci export --parts <dir>... [--out <file>]`, run in a fresh checkout of the same SHA after the shards, writes the D2 export (passes and skips) whose keys equal what a daemon computes for that content, with each file's `keyParts`.

Read: `spec.md` D9, D2, D11 (with the 2026-11-09 `keyParts` line); `tasks/018-16/notes.md` (part format `squeal-ci-part/1`, `src/core/ci/parts.ts` `readPart`); `tasks/018-18/notes.md` (re-key rule, key parts, seams).

Starting seam: a failing test first: run `squeal ci record` on a two-shard fixture, export the parts, and compare with `squeal export` from a daemon that ran the same fixture (equal keys and results per file; `keyParts` present). First edit offered as a lead: a `src/core/ci/export.ts` that builds closures with the daemon's own closure and key code (static graph plus the parts' observed reads), not a copy of it.

Refuse with a named reason: parts whose environment descriptors differ for one project; a part made with `updateSnapshot` other than `none`; a part that did not complete; a test file in two parts; parts from different commits.

Owns: `src/core/ci/export.ts` (new), `src/cli/ci.ts` (add the `export` subcommand), their tests.

Leave alone: `src/core/store/transfer*.ts` except through their exports; the daemon's keying code except to export a function; key inputs. No `pnpm run build`.

Done when: the comparison test passes; each refusal has a test; `squeal status --wait 60000 <changed paths>` read once (report pending as pending); lint and typecheck clean.

## 018-18 R1 and 018-16 S1: repair after review FAIL (`reviews/wave-5.md`)

Use /worker. Shape: repair, on candidate `cand/0.1.420`.

Outcome: an import never makes a pass current where a local run could fail: a re-key keeps every input the exported run read, and `allowOnly` is tolerated only in the safe direction.

Read: `reviews/wave-5.md` B1, B2, S1 with their reproductions and "Worker-sized fix" lines; `spec.md` D10, D11; `tasks/018-18/notes.md`.

Rules:
- B1: re-key a file only when the destination closure (this worktree's list plus the shared observed entries) contains every path of the exported closure, observed files and directory listings included. If one is missing, keep the results at the exported key (D3). Never widen the shared observed set or move a local key.
- B2: tolerate an unequal `allowOnly` only when the export ran with `allowOnly: false` (the CI side, which rejects `.only`) and this worktree's value is `true`. Keep true-to-false, unknown and unrecognized values keyed. Compare known boolean hashes; store no config value. Apply the same one-direction rule to `watch` if the reproduction shows the same shape, and say so.
- S1: make `test/cli/ci-usage.test.ts`'s unsupported-runner test run in a real child process or an explicit resolution seam; keep its exit code, named note and unchanged-tree assertions.

Starting seam: the review's two probes as failing tests first.

Owns: `src/core/store/transfer-rekey.ts`, `transfer-import.ts`, `src/core/keys/environment-descriptor.ts` (the `importDifferences` rule), `test/store/transfer-rekey.test.ts`, the D10 tests, `test/cli/ci-usage.test.ts`.

Leave alone: `src/core/ci/`, `src/cli/ci.ts` (018-17 runs beside you); key inputs. No `pnpm run build`.

Done when: both probes fail before and pass after; S1's test passes alone and with `ci-record.test.ts`; lint and typecheck clean; `squeal status` read once (pending stated as pending).

## 018-20 `squeal ci publish` and the reader

Use /worker. Shape: slice. Starts from the coordinator's branch with 018-17 (release 0.1.421 in review).

Outcome: CI publishes each main commit's export as `refs/squeal/<sha>` and prunes old ones; a daemon in a project with `shared.ref` fetches the right export in the background and imports it, never blocking a hook and never touching the user's git config.

Read: `spec.md` D13, D14, D15, D16; `research/transport.md` (all of it: ref shape, writer, flags, choice of export, trust); `tasks/018-17/notes.md`; `tasks/018-18/notes.md`.

Starting seam: a scratch bare repository under `$TMPDIR` as the remote in a failing test first: `squeal ci publish` writes `refs/squeal/<sha>` as a parentless commit whose tree holds the export, and deletes refs beyond `--keep` in the same push. Then the reader: the policy key `shared.ref` (policy schema), and a daemon step at start and when the worktree's nearest main commit changes: pick the nearest first-parent ancestor of `merge-base(HEAD, <remote>/<default branch>)` that has a ref (`git ls-remote` of that one ref is enough), fetch that one ref with `--no-write-fetch-head --no-auto-maintenance`, `GIT_TERMINAL_PROMPT=0`, ssh `BatchMode`, a kill timer of a few seconds, read the blob without writing a local ref, refuse unless the commit is on the default branch's first-parent line and the header names it, then import (existing D3/D11 code). One status note on a failed or slow fetch. Import one export per start point.

Owns: `src/cli/ci.ts` (the `publish` subcommand), `src/core/ci/publish.ts` (new), `src/core/shared/` (new, the reader), the policy schema entry for `shared.ref`, the daemon hook that calls the reader (one call site), their tests.

Leave alone: `src/core/store/transfer*.ts` except through exports; key inputs. Network I/O only in the reader, only with `shared.ref` set. No `pnpm run build`.

Done when: publish, prune, fetch, offline, a ref off the default branch refused, nothing written to the user's config or refs, and a daemon with `shared.ref` importing at start are each tested; lint and typecheck clean; `squeal status` read once without `--wait` (pending stated as pending).

## 018-17 R1: repair after review FAIL (`reviews/wave-5-0.1.421.md`)

Use /worker. Shape: repair, on candidate `cand/0.1.421`.

Outcome: `squeal ci export` writes a result only when it can prove the result belongs to that content and that the part set is complete; otherwise it refuses with a named reason. Conservative refusals are enough for this repair.

Read: `reviews/wave-5-0.1.421.md` B1 to B4 and S1 with their reproductions and "Worker-sized fix" lines; `spec.md` D8, D9; `tasks/018-16/notes.md`, `tasks/018-17/notes.md`.

Rules:
- B1: a part records, per test file, the content hash of every input the run read (git blob id of the bytes on disk; for a directory listing, its names hash), and the run's commit and whether its tree was clean. The export keys a file only when every closure input's hash in its own checkout equals the recorded one; any input missing from the record, or different, drops the file with a counted reason. An input git does not track (ignored or untracked) counts as different unless recorded and equal. Never just omit an input from a key.
- B2: compare `snapshotOptions` between part and export job field by field; only `updateSnapshot` (which must be `none`) is exempt; `snapshotFormat` and every other option must be equal, else refuse.
- B3: a part records its shard (`index/count`, or `1/1` without `--shard`); the export refuses unless it has exactly one completed part for every shard index of one count, and refuses an empty `--parts` directory.
- B4: when two checks of one test file share a full name (different lines or `test.each`), refuse that file with a named reason; do not guess locations or change daemon naming.
- S1: fix the tolerance test's hashes to real ones and the expected direction (export `false`, local `true`).

Starting seam: the review's reproductions as failing tests first.

Owns: `src/core/ci/` except `publish.ts`, `src/runners/vitest/ci-runtime/` and the part writer, `src/cli/ci-export.ts`, the part format version (raise it), their tests and the S1 test.

Leave alone: `src/core/ci/publish.ts`, `src/core/shared/` (018-20 runs beside you); key inputs; the daemon's naming. No `pnpm run build`.

Done when: each reproduction fails before and passes after; the comparison test still passes; lint and typecheck clean; `squeal status` read once without `--wait`.

## 018-17 R2: one owner for input evidence (the human, 2026-11-09: "A: one owner, repair")

Use /worker. Shape: repair, on candidate `cand/0.1.421`. This is the last round the human authorized; keep it narrow.

Outcome: the export certifies an input only by evidence taken while the run read it; a write during the run cancels that input's evidence; an input the run did not read, or whose absence the run did not observe, is never certified, so its test file is left out.

Read: `reviews/wave-5-0.1.421-r2.md` (B1, the three wrapper reproductions, "Required fix and decision boundary"); `reviews/wave-5-0.1.421.md` B1; the R1 section above; `tasks/018-17/notes.md` R1 section; `tasks/018-16/notes.md`.

The rule: in the CI path only, each process records, at the moment a file is read (including module loads through `fs`), its content hash; at the moment a directory is listed, its names hash; at the moment an absent path is probed, its absence. Any write, rename, delete or create of a path during the run marks that path written, which cancels its evidence for the whole run, even if the content is restored. The export keys a file only when every closure input has read-time evidence from that shard, none of it cancelled, and the export checkout matches it. Remove both endpoint shortcuts (clean-shard commit blob, inferred absence) and post-run hashing.

Seam: the CI hook layer (`src/runners/vitest/ci-runtime/`, loaded only by `squeal ci record`), not the daemon's recorder runtime: a change under the daemon's recorder files moves the key-format alarm for every user. If the evidence needs the recorder's own hooks, wrap them from the CI layer. Raise the part format version.

Starting seam: the review's three wrapper reproductions as failing tests first; keep every earlier B1 to B4 test passing.

Owns: `src/runners/vitest/ci-runtime/`, the part writer, `src/core/ci/` except `publish.ts`, `src/cli/ci-export.ts`, their tests.

Leave alone: the daemon's recorder runtime and key inputs (`test/keys/key-format.test.ts` must pass unchanged); `src/core/ci/publish.ts`, `src/core/shared/`. No `pnpm run build`.

Done when: the three reproductions fail before and pass after; the two-shard comparison test still exports the files a clean run proves; report how many fixture files the stricter rule leaves out and why; lint and typecheck clean; `squeal status` read once without `--wait`.

## 018-17 R3: one path, one content per run (the human, 2026-11-09: "A: one more repair")

Use /worker. Shape: repair, on candidate `cand/0.1.421`. Narrow.

Outcome: a path whose evidence shows more than one content (or content and absence) within a run has no evidence, and the export leaves its test files out; writes through every file API cancel evidence.

Read: `status.md` line of 2026-11-09 on the third review (the case: a test reads a file, a writer outside Node changes it, the test reads it again in the same turn; the evidence object kept only the last hash); the R2 section above; `tasks/018-17/notes.md`; `src/runners/vitest/ci-runtime/evidence*.cjs`.

Rules:
1. Evidence per path is a set across the whole run and every process and thread of the shard, not the last value: two different hashes, a hash and an absence, or two different listings for one path cancel that path.
2. Writes cancel evidence through every route: `fs.write`/`writeSync` on a descriptor opened for writing, `FileHandle` writes, write streams, `truncate`/`ftruncate`, `copyFile`, `cp`, `appendFile`, `rm`/`rmdir`/`unlink`, `rename`, `symlink`/`link`, `mkdir`, `utimes` are not content but count as touched only if trivial to add. A descriptor opened for writing marks its path at open.
3. Symbolic links: evidence and writes are keyed by the real path; a write through a link cancels the target; a read through a link records the target.
4. Recursive listings record every directory listed.

Starting seam: failing tests first for rule 1 (read, outside-Node rewrite, read again in one turn), a descriptor write, a write stream, and a write through a symbolic link; keep every earlier export test passing.

Owns: `src/runners/vitest/ci-runtime/`, `src/core/ci/` except `publish.ts`, their tests.

Leave alone: the daemon's recorder runtime and key inputs (`test/keys/key-format.test.ts` unchanged). No `pnpm run build`.

Done when: the new tests fail before and pass after; the two-shard comparison still exports its 4 files; lint and typecheck clean; `squeal status` read once without `--wait`.
