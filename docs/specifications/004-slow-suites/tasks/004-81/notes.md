# 004-81 worker notes: build-output suites leave Squeal; `vitest.exclude`

Baseline: cand/0.1.219 (004-78, 006-91). Version 0.1.220. `KEY_FORMAT_VERSION` 13.

## Seam map

- `vitest.exclude` enters at `src/core/types/policy.ts` (`Policy.vitest.exclude`), is validated in
  `src/core/daemon/policy.ts` (a bad glob reports a problem and excludes nothing, as
  `nodeTest[].exclude`), and reaches the Vitest adapter as a getter
  (`src/runners/vitest/index.ts` `exclude`, wired in `src/core/daemon/daemon.ts`). The adapter
  (`src/runners/vitest/adapter.ts`) filters `testFiles()` and `affected()` through
  `#covered`, and recreates its Vitest instance when either exclusion changes
  (`excludedStamp`), so a mid-session edit relists. Nothing downstream lists, keys, runs or
  counts a file the adapter never lists.
- Naming it: `squeal status` (`format-status.ts` `excludedLine`, from
  `status/snapshot.ts`), the primer (`harness/shared/primer.ts` `notCovered`, from
  `coverage.ts`), `setup --check` and `--plan` (`cli/setup/plan.ts` `excluded`,
  `format.ts`). Text lives in `core/text.ts` `excludedFilesText`.
- Deleted outward: preconditions (`policy-precondition.ts`, `slow/precondition.ts`,
  `setup/preconditions.ts`), skips (`scheduler/slow-skip.ts`, `state/slow-skipped.ts`,
  `cli/run-skipped.ts`), the artifact rule and its keys (`slow/inherit.ts`,
  `keys/ignored-inputs.ts`, `state/slow-sources.ts`, the `#ignored*`/`#artifactRule` parts of
  `scheduler/keying.ts`, `ledger.probe`'s `inherits`), slow artifact records
  (`slow/state.ts`), the `slowArtifact` delivery line (`delivery/attribution.ts`,
  `format.ts`, `provenance.ts`), and setup's artifact proposals and input question.

## Decisions the spec did not settle

1. **Build-output finders kept** (coordinator's scope note): `src/cli/setup/artifacts.ts`'s
   evidence finders (package.json bin/main/module/exports/files, the build script's outDir,
   gitignored directories named in tests) now stand alone in
   `src/cli/setup/build-outputs.ts` as `buildOutputCandidates(facts, dir, files)`; nothing
   calls them yet, row 005-70 will. Only `holdsArtifact` (whether a declared input covers a
   candidate) went, since it only served the artifact proposal.
   `src/cli/setup/candidates.ts` stays: it still finds slow groups; it lost only the
   artifact candidates.
2. **`--input` stays a setup flag**, though no question asks for it now. The setup skill
   says to pass it only for a committed file the user names, and never build output.
   Dropping the flag would touch `apply.ts`, the flow tests and the real-cli bullet 4; left
   for 005-70.
3. **A leftover `nodeTest[].precondition`** is an unknown key: per the loader's rule the
   whole project is skipped with a note. A leftover `slow.precondition` is an unknown key
   reported; the rest of `slow` applies.
4. **Gitignored declared inputs** are all dropped at bootstrap and never tracked from a
   declaration now; before, a slow file's declared artifact was the one exception.
5. **Slow failures carry closure changes** like any file's (`withClosureChanges`, `attribute`),
   since the artifact line they had instead is gone.
6. **Schema versions unchanged.** `SETUP_PLAN_SCHEMA_VERSION` stays 1 though
   `slow.groups[].artifacts/broader/inputsHoldArtifact` and `preconditions` left the plan, and
   the status payload's `SlowTierState.artifact/artifactUnknown/sourcesChangedSince/skipped`
   left without a payload bump: removals only, and `evals/lib/grade.mjs` pins status
   schema 1. A reader of the old fields sees them absent.
7. **Old `meta` rows** `slow-artifacts:` and `slow-skips:` are no longer in
   `WORKTREE_META_ROWS`, so a store from 0.1.219 keeps them, a removed worktree's too;
   nothing reads them. A cleanup, if wanted, is a one-off delete by prefix.
8. **`KEY_FORMAT_VERSION` 13**, not a re-pin of 12: keys of slow files with a gitignored
   declared artifact change (the artifact is no longer an input). The guard case for the
   deleted `slow/inherit.ts` now points at `slow/classify.ts`.

## Outside the named ownership, touched and why

- `plugins/{claude-code,codex}/skills/setup/SKILL.md`: the "Re-run a group when an artifact
  changes?" row asked a question setup no longer asks; the input sentence now says no build
  output.
- `plugins/{claude-code,codex,pi}/skills/squeal/references/reports.md` (the slow-tier states
  lost the artifact wording) and `policy.md` (a `vitest.exclude` row).
- `test/e2e/slow-*.ts`: their CLI is committed in the fixture, so it is a tracked declared
  input and the scenarios still hold; the artifact fields and the "against X as of revision N"
  wording went. They run against the committed bundles, so they fail until the candidate's
  `npm run build` (this row ran none): the slow failure's line reads as any file's only in
  the new bundle.
- `test/real-cli/setup.real.ts`: bullet 3 (artifact proposals) deleted; bullet 4 kept.

## For 004-80

The slow tier is smaller: `SlowTier.next()` has no precondition or skip step, `SlowRun` is
`{ tier, slot }`, and `ended()` has no recheck. `slow-text.ts` ends the line with
`stopText` and the `run --slow` suffix; the continuous wording goes there.
