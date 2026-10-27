# 017-10.R2: independent history and current state

Repair of review `../../reviews/0.1.364-r2.md`, B2-R and N1. Human
permission is recorded in `../wave-2.6.md`. No delegation.

## The rule

`lint-report.ts` no longer tests whether a result belongs to a transition.
Every changed line states two independent facts:

1. Historical evidence comes only from `kind`, `added`, `removed` and
   `revision`. A first failure or pass-to-fail transition adds every
   finding, so its count is `added.length`. A changed failure has no saved
   total; its line says `findings not stored`.
2. The current state always follows. It includes the outcome, current
   count, judged revision and stale qualification, or the pending/unknown
   reason. A deleted or excluded file says `now not linted`.

For the review's exact case:

```text
PASS lint: src/a.js: no findings; at revision 2; now fail: 1 finding, linted at revision 2
```

An unchanged pass now also states `now pass: no findings, linted at
revision 2`. A stale pass states that outcome and the existing `LINT_STALE`
qualification. Historical evidence never inherits the current stale flag.

The JSON already carries historical fields and current fields separately.
Its shape is unchanged. `LintChangedEntry` comments now state that
`judgedAt` is provenance, not result identity. No type signature, store
schema, producer, key, provider, shared formatter, cap or Stop change.

## Evidence tests

- `report.test.ts`: the first discriminating regression failed at Squeal
  revision 1 and passed after the rule changed. It covers same-revision
  PASS/current FAIL and a changed failure whose historical total cannot
  be inferred from the current total.
- `same-revision.test.ts`: real ESLint 9.39.5 and 10.13.0 on core rules.
  `eslint.config.js` imports `rules.mjs`, written only on disk, outside
  the listing. After a source edit at revision 2, editing only that module
  and nudging the pass changes the key and current result at revision 2.
  Tests cover historical PASS/current FAIL and historical FAIL/current
  FAIL with equal counts but different rules, in text and JSON. Stored
  findings equal an independent fresh `eslint -f json` run.
- `eslint-rig.ts`: reconstructs the stored key from the provider's
  actual held-read hashes and the source text supplied to lint. Every
  observed non-package read must be in the closure or source, with no
  unobserved read. The reconstructed key must equal the stored key.
  `rules.mjs` must have the expected input blob. Node-major metadata is
  required for this reconstruction. Parent request `66147ec4` approved
  only the needed comments in `test/version-sensitive.txt`.
- The forced edits run after `refresh`, `inputs` and `lint`, on both
  majors. The first stored result must still key its actual reads. A
  further nudge must use the new bytes, with fresh ESLint findings. An
  edit after the pass sampled its inputs can leave the first result
  correctly stored under the earlier bytes. Comparing those reads to
  newer disk bytes was an incorrect first test assertion; the corrected
  test validates both keys and the subsequent nudge. No producer defect
  or ownership expansion was required.
- No-op nudges preserve the key and JSON. Existing later-revision,
  stale-pass, pending, unknown, removed, changed-rule and store-read to
  disk-read edit controls remain.
- `bundled.test.ts`: all four committed CLI entry points, both majors,
  both historical outcomes. Each runs the same real unlisted-module
  fixture, checks exact text and JSON parity, and retains the later
  config change and stale-pass controls. This is the parent's rebuilt
  four-CLI proof. Old committed bundles remain red in this worker tree.

## Node 22 fixture assertion

`child-env.test.ts` removes only one exact, complete Node SQLite warning
from the start of stderr, then requires an empty remainder. Any extra
stderr, including another warning, still fails. Exact stdout, exit code,
identity isolation and teardown/shutdown behavior remain. Node 22.19
emits the allowed warning; Node 24.21 passes with empty stderr.

## Commands and actual results

The task requires the Node 22.19 runtime check, so these direct targeted
runs supplement Squeal. No full suite or checkpoint was run.

```sh
PATH=/home/agent/.nvm/versions/node/v22.19.0/bin:$PATH \
pnpm exec vitest run \
  test/lint/cli/same-revision.test.ts \
  test/lint/cli/changed-eslint.test.ts \
  test/lint/cli/report.test.ts \
  test/lint/cli/changed-state.test.ts \
  test/lint/cli/disk.test.ts \
  test/lint/cli/lint-command.test.ts \
  test/daemon/child-env.test.ts test/version-sensitive.test.ts --maxWorkers=2
```

Exit 0: **8 files passed, 47 tests passed**, 36.60 s. The initial run
failed four assertions which compared earlier worker reads to newer disk
bytes; see the corrected attack test above.

After tightening the key helper to reject missing results and non-current
states, and the stderr assertion to reject any remainder:

```sh
PATH=/home/agent/.nvm/versions/node/v22.19.0/bin:$PATH \
pnpm exec vitest run test/lint/cli/same-revision.test.ts \
  test/lint/cli/changed-eslint.test.ts test/daemon/child-env.test.ts --maxWorkers=2
```

Exit 0: **3 files passed, 17 tests passed**, 38.11 s.

```sh
PATH=/home/agent/.nvm/versions/node/v24.21.0/bin:$PATH \
pnpm exec vitest run test/daemon/child-env.test.ts --maxWorkers=1
```

Exit 0: **1 file passed, 3 tests passed**, 7.01 s.

`pnpm run typecheck`: `tsc --noEmit`, exit 0, no diagnostics.

`pnpm run lint`: initial pass, 2421 files checked. A later run caught
formatting of the stricter stderr expression; fixed with Biome. Final
lint and Squeal results follow below.

Squeal at revision 9, the eight focused paths listed in the first command:
**no known failures; 8 test files, each with a current result**. Worktree
had 12 failures from old bundles and 1074 non-current files (565 queued,
509 unknown). This was a focused pass, not a broad pass.

## For the parent

Worker implementation: `7703d41d8`. Tests and these notes are in the next
commit. No known wrong-key pairing remains in the focused attacks.

The parent owns version, build, committed bundles, candidate CI and the
human-authorized review. This worker ran no build, version bump, board or
status edit, full suite or checkpoint. After the parent rebuild:

```sh
PATH=/home/agent/.nvm/versions/node/v22.19.0/bin:$PATH \
pnpm exec vitest run test/lint/cli/bundled.test.ts \
  test/lint/cli/same-revision.test.ts test/lint/cli/changed-eslint.test.ts \
  test/lint/cli/report.test.ts test/lint/cli/changed-state.test.ts \
  test/lint/cli/disk.test.ts test/lint/cli/lint-command.test.ts \
  test/daemon/child-env.test.ts test/version-sensitive.test.ts --maxWorkers=2
```

Repeat that focused command on Node 24.21. The four-bundle file has 24
cases: 16 real same-revision cases and eight existing config/stale cases.
The rebuilt bundle proof and candidate CI are not claimed as passed here.

## Final affected evidence

- Final `pnpm run lint`: **Checked 2427 files in 2s. No fixes applied.**
- Final `pnpm run typecheck`: `tsc --noEmit`, exit 0, no diagnostics.
- `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait
  60000` with all changed code/test/header paths: exit 3 at revision 13.
  The broad selection had 565 test files pending after 60.4 s. Known
  failures: 20 cases in `bundled.test.ts` and one Codex bundle-drift
  assertion. All are from committed bundles left unchanged for the
  parent. No broad pass is claimed; no backlog catch-up was awaited.
- The same command with the eight focused test paths: exit 0 at revision
  13, **no known failures; 8 test files, each with a current result**,
  after 59.1 s. Worktree totals then: 21 known failures as above, 1062
  non-current files (1 running, 552 queued, 509 unknown). These totals
  are not evidence of a passing full suite.
