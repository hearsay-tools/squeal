# 005-128 notes: the short start message, the skill texts and `squeal checks` ship

Wave 31 (`../wave-31.md`). Base: main plus the experiment's commits (`8ef81a3ef`). No build, no version raise in this worktree: the committed `plugins/*/dist`, `plugins/codex-runtime/runtime.json` and the Pi package drift until the coordinator builds.

## What was removed

`src`: 658 lines out, 83 in (21 files).

| What | Where | Lines |
| --- | --- | --- |
| The long primer: `momentsSentence`, `waitSentence`, `retrySentence`, `slowSentences`, `coversSentence`, `suite`, `excluded`, `named`, `listed`, `runnersOf`, `projectsOf`, `droppable`, `withPathWait`, `folded`, `shortForm`, `RUN_YOURSELF`, `REVISION`, `AT`, the `Droppable`, `WaitForm` and `PrimerForm` (full) types, `PRIMER_FORM` and its switch | `src/harness/shared/primer.ts` | 488 → 102 |
| The forms `minimal` and `minimal-rules`; `SHORT_FORMS`/`SHORT_OPENING` renamed `FORM_TEXTS`/`PRIMER_FIRST`, type `PrimerForm = "skill" \| "no-skill"` | `src/harness/shared/primer-forms.ts` | 52 → 40 |
| `Coverage`, `GroupsCoverage`, `DEFAULT_COVERAGE`, `coverageOf`, `groupsCoverage` (the primer's coverage read, one store read per hook that said a primer) | `src/harness/shared/coverage.ts` | 111 → deleted |
| `RunnerDescription.covered`, `.built`, `.fallback`, the `Covered` type; Vitest's `vitestConfig` (and `configFile`'s config lookup) and `vitestExcluded` in the coverage | `src/runners/descriptions.ts`, `src/runners/*/describe.ts` | 79 out |
| `primer(command, coverage, options)` → `primer(command, options)`; `withPrimer` alike; the five callers stop reading coverage | `shared/session.ts`, `shared/owed.ts`, `opencode/bridge.ts`, `opencode/bridge-turn.ts`, `pi/run.ts` | |

Tests: **removed with their subject**, 11 harness files (58 tests: `primer-coverage` 12, `primer-excluded` 5, `primer-groups` 5, `primer-listing` 4, `primer-no-edit-cap` 5, `primer-no-edit` 6, `primer-over-cap` 5, `primer-slow-policy` 4, `primer-wait-forms` 1, `primer-wait` 8, `shared/primer-pytest` 3), 3 eval files (13 tests: `primer-variants` 2, `skill-form-variants` 7, `skill-variants` 4), and 3 single tests (`group-texts-golden` "the primer under each slow policy", `codex/output` "keeps the primer that names node:test whole", `manual-check`'s form-A reference session). `test/harness/primer-helpers.ts` became `test/harness/codex-cli.ts` (only `CODEX` was still used). **Rewritten** for the short message or the new skill: `primer-forms.test.ts` (11 → 6 tests), `session-start` 1, `codex/command` 1, `codex/hooks` 1, `codex/version-copies` 1, `pi/run` 1, `skill.test.ts` 11, `skill-wait` 2, `skill-no-edit` 2, `manual-check` 2, `opencode/turn` 1 (its coverage-following case became the no-skill message's). **New**: `test/evals/start-message.test.ts` (12), `test/evals/node-test-cut.test.ts` (5), `test/cli/checks.test.ts` 1, `manual-check` 2, `test/delivery/control-wording.test.ts` 1.

Eval variants deleted: `primer-minimal`, `primer-minimal-rules`, `primer-minimal-skill`, `primer-minimal-desc`, `primer-skill`, `primer-skill-noproof`, `primer-noskill`. Their results files stay; `evals/README.md` says in one line whose they were.

## What stayed, and why

- `PRIMER_CAP_CHARS` (1,500) and `trailingPrimer`: Codex's cut of a hook's text (`codex/output.ts` `capContext`, `codex/kept.ts`) keeps a trailing start message whole by them, and `primer` still names a Codex CLI fewer times, then not at all, to stay within it (a Codex path may be thousands of characters).
- `PRIMER_OPENING`: `trailingPrimer` finds the message by it; the OpenCode and Pi e2e tests read it.
- `withPrimer`: the registration above the start message is unchanged; its room is the cap less the (now shorter) message.
- `not-covered.ts` (`notCovered`): `squeal checks` ends with it. It now takes `RunnerCoverage`, not the primer's `Coverage`.
- OpenCode's own `PRIMER_CAP_CHARS` (8,000, `opencode/hooks.ts`): the system prompt's cap, not the primer's.
- `HookDeps.registrationPrimer` and the owed-registration `primer` flag: they say whether a registration carries the start message, whatever its form.
- The runner coverage read (`RunnerCoverage`, `runnerCoverage`, `CoverageRead`, each description's `coverage`): `notCovered` reads Vitest's `vitest.exclude` globs through it. After this row nothing else reads the node:test and pytest project lists in it; a later /quality scan can fold it to the one key `notCovered` reads.

## The Codex seed

`plugins/codex/seed` stays at 0.1.368 (the coordinator, decision (a), 2026-11-19): it is a whole frozen runtime with a sha256 manifest, and its CLI has no `squeal checks`, `squeal proof` or `status --at`. A Codex session reads the seed's long start message and old skill only while no runtime is installed: before `squeal codex-runtime ensure` or `update` has selected one (install.sh runs both; a session start also looks for a new runtime in the background), or when the plugin data directory was deleted. Once a runtime of this release is selected, sessions started after it get the short message and the new skill. The fixed plugin's own short files (`plugins/codex/skills/squeal/SKILL.md`, `plugins/codex/skills/setup/SKILL.md`) are unchanged: the coordinator reverted this row's edits of them, since a change in the fixed Codex plugin is an adapter release (spec 002 D7). They keep the old description and "the command the SQUEAL primer names" until the next adapter release; the runtime's skill, which they send the agent to, has the new text.

## Agent-read sentences changed outside the four approved text sets (for the human)

1. `SKILL.md`, Reference bullet for `commands.md`: "what `squeal status`, `squeal why` and `squeal run` print" → "what `squeal checks`, `squeal status`, `squeal why` and `squeal run` print" (the rest of the bullet is spec 023's approved edit).
2. `references/commands.md`, a new first section, "## squeal checks" (the brief's point 3): "Lists the checks Squeal runs in this repository, from `squeal.config.json`, or the default ones when it has no `checks` key. One block per check, one fact per line:", an example block the CLI prints (pinned to the CLI's output by `test/cli/checks.test.ts`), then "`Description` appears only where the config gives one; `Test files now` and `Last result` only where the store has the check's files. `Runs` says when the check runs (after each edit, between your turns, at Stop, when you commit, or only on request) and who starts it. The last line names what Squeal does not run here, such as typecheck and build: those are yours to run. It needs no daemon and changes nothing."
3. `references/policy.md`, the `checks` row:
   - before: "Optional: `after` (groups this one runs after at its moment), …" → after: "Optional: `description` (one line of up to 200 characters that only `squeal checks` prints), `after` (groups this one runs after at its moment), …";
   - "a lint group has only `name`, `lint` and `at`," → "a lint group has only `name`, `lint`, `at` and `description`,";
   - "With the key, the session's first message names each moment's groups;" → "`squeal checks` lists each check with its moment and the command that runs it;".
4. `references/policy.md`, `vitest.excludeProjects` row: "`squeal status` and the session's first message name each as not run," → "`squeal status` names each as not run,".
5. `references/policy.md`, `vitest.exclude` row: "`squeal status`, `squeal setup --check` and the session's first message name the globs as not covered," → "`squeal status`, `squeal setup --check` and `squeal checks` name the globs as not covered,".
6. `README.md` (human-read): a new section "The checks of a repository" on `squeal checks` and `description`, and in "Tests Squeal does not cover" "the session's first message" → "`squeal checks`".

No hook, status, Stop or `squeal --help` text said "the primer lists" or leaned on a sentence only the long primer had: the edit lines' no-test-group sentence (`quietEditsText`) states its own condition and command, and `--help` already lists `squeal checks`.

## Eval

- **A defect found**: `manualChecks` (`evals/lib/grade.mjs`) matched `  Runs: only on request` only as a whole line, 005-126's first form. The shipped line goes on (`only on request: Squeal does not start it; …`, round 2, `951cfe380`), so `checks` steps never listed the contract check, and `route-looked-up` never credited `squeal checks` in the experiment's runs. That row is context only, and the findings do not use it. Fixed, and gated on the CLI's own output (`manual-check.test.ts`).
- `waitingOf` (`squeal-text.mjs`) no longer reads the long primer's "waits for the CLI's `run …`" form; a start message was never a look-up (`lookedUp` reads replies only).
- The start message's readers (`squealEvidence`, the grader's registration kind) are gated on the real message in both forms, `squeal` and a Codex path (`start-message.test.ts`).
- **`own-run-covers`** (`evidence.mjs`, `completedRuns`): a node:test output with no `tests` line, its summary cut by `| tail` to `todo` and `duration_ms`, now counts as completed when it shows a test that passed or failed (spec `✔`/`✖ name (Nms)`, TAP `ok`/`not ok N - name`, not skipped or todo). Both kept shapes of run 20261119T001551Z-264cf1 (`node --test … | tail -25`, `npm run test:scripts 2>&1 | tail -30`) are the test's. The committed results files are not regraded; a regrade of the a5 files would raise `own-run-covers` in both arms.

## Docs under `docs/` left for the coordinator

The specs describe the long primer in decisions and amendment logs that the 2026-11-19 amendments of 005 D6 and 019 D6 supersede: `001-core-loop/spec.md`, `002-codex-adapter/spec.md`, `004-slow-suites/spec.md` (D8, the primer's slow sentences), `006-model-evals/spec.md`, `008-opencode-adapter/spec.md`, `009-pi-adapter/spec.md`, `011-core/spec.md`, `012-claude-code-adapter/spec.md`, `014-ps/spec.md`, `016-extensions/spec.md` (D5, the runner's entry in the coverage list). Specs are the coordinator's; I did not edit them.

## e2e files that need the build

- `test/e2e/run-triggers.test.ts`: its first registration now matches the short message (`PRIMER`).
- `test/e2e/run-triggers-control.test.ts`: its wording pass (`control-wording.ts`) maps 0.1.393's long start message to the short one. The registration's room grows with a shorter message; I did not check whether this fixture's 0.1.393 registration was cut at the cap.
- `test/e2e/opencode.test.ts`, `test/e2e/pi.test.ts`: unchanged; they read `PRIMER_OPENING`, which stays.

## Checks run (2026-11-19)

- `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:private`: clean.
- Squeal at revision 52: known failures 6, all bundle or runtime-manifest drift that the coordinator's build clears (`plugin.test.ts`, `codex/packaging/runtime.test.ts` ×2, `codex/runtime-release/limits.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`); 529 test files still queued after 20 minutes, so per the brief run directly, one directory at a time: `test/keys/key-format.test.ts` 12 passed; `test/evals` 92 files passed; `test/runners` 189 passed; `test/harness` 189 passed, 6 failed (the drift above, and `opencode/turn.test.ts`, then rewritten and passing); `test/status` 75 passed; `test/delivery` 66 passed; `test/cli` 254 passed; `test/integration/pi-events`, `pi-silence` passed.
- Not run: `test/e2e/**` (needs the build).

## Repair after the review of cand/0.1.565

`squeal checks` hid the default lint block once any `checks` entry was a lint check, so a tool no lint check owns (lint at each edit, 019 D2) went unlisted (D6). The block now lists the tools `lintGroupOf` (`src/core/lint/pass/moment.ts`, the lint pass's own ownership rule) finds no group for, and is absent when lint checks own every tool. `test/cli/checks.test.ts` pins the reviewer's config (eslint and oxlint, a manual group with eslint only: an `oxlint` block), every tool owned, no lint check, and lint off.
