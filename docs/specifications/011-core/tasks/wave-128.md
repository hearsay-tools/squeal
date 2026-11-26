# Wave 128: status stops calling an on-request check's files queued (#293)

The human, 2026-11-27 (task 22635d91: "Fix GitHub issue #293"). Coordinator 22635d91. One worker, one candidate with a version raise. Spec 011 C6 (status) and C15 (named waits); spec 023's held groups (`at: "commit"` / `"manual"`, rows 023-67, 023-79).

## Row 011-426 (worker; shape: slice)

**Outcome.** A pending file of a group that runs only on request (`heldUntilAsked`, not asked by a request) is counted and listed as "on request", never "queued"; and `status --wait` says when nothing left will run by itself.

**Evidence.** [#293](https://github.com/hearsay-tools/squeal/issues/293), 0.1.645: `not current: 145 of 2062 test files (98 queued, 47 unknown)` beside `0 queued` and `browser: ... 98 pending, waiting for squeal run browser`; the agent waited five more times.

**Read.** `docs/styleguide.md`; the issue; spec 011 C6; `src/core/status/phase-files.ts` (`pendingPhasesOf`: every pending file not running is `queued`); `src/core/status/checks.ts` (`notCurrentText`, `splitPending`); `src/core/state/groups.ts` (`heldUntilAsked`, `requestedOf`: a held file asked at its key is requested and stays queued); `src/core/status/outstanding-text.ts`; `src/cli/status-wait*.ts`, `src/cli/no-verdict-lines.ts`.

**Contract (the coordinator's).**
1. Headline: `(98 on request, 47 unknown)`; `queued` counts only files that will run by themselves. Same split in the tests clause, the registration header and delivery's news form, since they share the reader.
2. The `Queued:` line leaves on-request files out; they stay under their group's line, which already names `squeal run <group>`.
3. JSON is additive: `testFilesByPhase` (and `testsByPhase`) gain `onRequest`; `queued` drops those files; `pendingTestFiles` gains an `onRequest` list. Update the evals parsers and fixtures that read these (`test/evals/*`), round-tripped through the real formatters.
4. `status --wait` (text and JSON): when every file the wait selects is current and every file not current is on request or unknown with nothing queued, add one line: `Nothing left runs by itself; waiting again changes nothing.` When the edits select files of an on-request group, name `squeal run <group> --base <ref> --wait` (the ref the wait compares against, else omit `--base`). A plain `status` gets no such line.

**Owns.** `src/core/status/`, `src/core/state/groups.ts`, `src/core/types/{state,status,standing}.ts`, `src/cli/status-wait*.ts`, `src/cli/no-verdict-lines.ts`, their tests, `test/evals/*` parsers, `docs/specifications/011-core/tasks/011-426/`. Not `docs/board.md`, `package.json`, bundles, `spec.md`.

**Done when.**
- Tests fail before and pass after for: a manual group's 98 held files read `98 on request`, not `queued`, in text and JSON; a held file asked by a request stays `queued`; the `Queued:` line omits held files; the wait's line appears exactly in the stated case and names the command only when the edits select a held group's files.
- `pnpm run lint`, `pnpm run typecheck`, and `squeal status --wait 60000 <changed-path>...` read and reported. Direct `vitest run` names its files and runs under `timeout 600`. No build, no full suite.
- Commits on the worker branch; the final message lists any spec text C6 needs and any JSON change.
