# Issue 35: slow-tier completion advice runs package tests without their build output

Brief: `probes/issue-35/README.md`. Researcher: Opus 5.5, 2026-10-18, 20-minute bound, documentation only. Issue read with `gh issue view 35` (open; labels `area-slow-suites`, `bug`, `friction`, `needs-triage`; no comments). Examined: the installed plugin `~/.claude/plugins/cache/hearsay/squeal/0.1.199` (`squeal --version` 0.1.199) and main `8ec92f9b`, whose committed `plugins/claude-code/dist` reports 0.1.213. 004-65 (0.1.214) is not on main. Node v24.21.0. Host: 24 CPUs, one-minute load 10.75 before the first probe, 10.68 and 16.70 at the two recorded runs, all below the CPU count, so the live probe went ahead. The reporter's policy was read in cezarion at `463a5bf0` (`squeal.config.json`). Nothing in product code, tests, spec, status, skills or board was changed. Nothing was built.

## Verdict

The defect reproduces on both versions with the same mechanics. A docs-only edit leaves the affected checks quiet. `status --wait 60000` then names `squeal run --slow --wait 60000`, and that command runs every not-current slow file with no check for the build output they test. The result is 4 first-seen failures in 4 shapes, `ERR_MODULE_NOT_FOUND` among them. `run --slow --wait` exits 0, and the `Slow tier:` line reads "3 current against dist/** as of revision 1" while `dist/` does not exist.

The two versions differ only in what the primer and skill require. On 0.1.199 they require the whole slow tier before "done" under every policy (#5/#29, fixed by 004-62 in 0.1.202). On main, with `requireSlowSuite: false`, they say to count the files that are not current. One pointer did not move: the quiet `status --wait` line, which the issue calls "its advice", names `run --slow --wait 60000` under every policy on both versions.

Two of the issue's asks are already covered by rows: missing-prerequisite protection is 004-65, and the policy-off requirement is 004-62. Two are not: the quiet line's policy-independent pointer, and whether a docs-only edit may finish policy-on with unaffected slow files unverified. Both are undecided and need the human's call (open questions).

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does following the completion advice after a docs-only edit queue package tests without their build artifacts? | Yes. 3 slow files ran, 4 failures (3 tests, 1 file that did not load), stored current, exit 0 | verified by experiment, 0.1.199 and 0.1.213 |
| 2 | Do installed 0.1.199 and main differ? | Not in the run: same failures, same exit code, same `Slow tier:` and quiet-wait lines. Only in the before-done text: 0.1.199's skill step 4 requires the slow tier under every policy. Main's step 4 says "Without `Stop waits`, say how many are not current" | verified by experiment (run); read in source code (skill, both trees) |
| 3 | Which text sends the agent to `run --slow`? | On both versions, the quiet `status --wait` line: "3 slow files are not current, which this wait does not hold for: `squeal run --slow --wait 60000` runs and waits for them". It does not read `stop.requireSlowSuite`. On 0.1.199 the primer and skill step 4 also require it | verified by experiment; read in source code, `src/cli/status-wait-lines.ts:124-132` |
| 4 | Did the docs edit itself queue a slow file? | No. Revision 1 re-keyed only `docs.test.mjs`, whose declared input is `AGENTS.md`. It passed, and the slow tier stayed "not run at revision 1. Squeal has not queued them" | verified by experiment |
| 5 | Is missing-prerequisite protection already covered by 004-65? | Yes for the run, but only once cezarion declares `slow.precondition`. With it, an unmet `exists`/`command` skips the tier with one reason, stores nothing, and makes `run --slow --wait` exit 3. Not covered: naming the build command (the reason names the precondition), and a precondition inferred from `inputs` that match nothing (excluded by the amendment). Not on main yet | read in source code (`spec.md` D7/D8 as amended, `tasks/004-65/amendment.md`, board row 004-65) |
| 6 | Which docs-edit exemption remains undecided? | Policy off: whether the quiet `status --wait` line should stop pointing at `run --slow` and say that the tier is not required (plus 029's open question 1 on `run --all --wait`). Policy on: whether an edit that re-keys no slow file is exempt as a no-edit session is (004-67 exempts only "no revision since registration") | inferred, from findings 3–4 and `spec.md` D7–D9 |
| 7 | Is it the original 13-file incident? | No. This is a representative fixture of the same shape: node:test `test:package` with `slow: true`, a gitignored `dist/` declared in `inputs`, `lookup-only`, and policy off | not determined, because cezarion's suites were not run (out of scope by the brief) |

## Reproduction (verified by experiment)

Fixture: issue #3's (`probes/issue-3-preconditions/fixture`) plus `probes/issue-35/overlay/`. The overlay adds an `AGENTS.md`, one unit test whose declared input is `AGENTS.md`, and cezarion's `stop` and `baseline` keys at `463a5bf0`: `requireFullSuite: false`, `requireSlowSuite: false`, `waitMs: 0`, `baseline.onStart: "lookup-only"`. From the repository root:

```sh
P=docs/specifications/004-slow-suites/research/probes/issue-35
SQUEAL_CLI=$HOME/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs sh $P/run.sh > $P/output-0.1.199.txt 2>&1
SQUEAL_CLI=$PWD/plugins/claude-code/dist/cli/squeal.mjs sh $P/run.sh > $P/output-0.1.213.txt 2>&1
```

`run.sh` runs in a fresh scratch repository with `env -i` and HOME/XDG inside it. Each command is under `timeout 150`. The steps are `start`, `status --wait 60000`, append one line to `AGENTS.md`, `status --wait 60000`, `run --slow --wait 60000` twice (in a first, unrecorded attempt each version's first wait returned on the first of 4 transitions), `failures`, `stop`. Afterwards no daemon remained (`pgrep -af issue35-`), and the scratch directories were removed.

After the docs edit (0.1.213; 0.1.199 prints the same lines without the `Idle:` line and the quiet line's `Worktree:` suffix):

```text
Known failures: 0
Affected checks: 2 passed (1 test, 1 test file loaded), 0 running, 0 queued
Slow tier: 3 test files; 3 not run at revision 1. Squeal has not queued them; `squeal run --slow` runs them now.
Returned on quiet: nothing the edits since revision 1 re-keyed is pending (1 test file) at revision 1 after 0.5 s; 3 slow files are not current, which this wait does not hold for: `squeal run --slow --wait 60000` runs and waits for them. ...
```

Then `run --slow --wait 60000`:

```text
Slow tier requested at revision 1: 3 slow files queued; they run once no fast work is pending.
Known failures: 4 (3 tests, 1 test file that did not load)
  FAIL  [test:package] test/e2e/bin.test.mjs > every declared bin exists
        dist/cli.mjs is missing
  FAIL  [test:package] test/e2e/cli.test.mjs > the CLI exits 0
  FAIL  [test:package] test/e2e/cli.test.mjs > the CLI greets the named user
  FAIL  [test:package] test/e2e/import.test.mjs (file-level)
        Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'dist/index.js' imported from test/e2e/import.test.mjs
Slow tier: 3 test files; 3 current against dist/** as of revision 1. Squeal runs them when the agent pauses.
[exit 0]
```

`dist/` did not exist after the run. Both runs also printed D5's "no declared artifact" note at revision 0 although `dist/**` is declared. That is issue #3's finding 3: the note fires because the declared input matched no file, and its advice is wrong in that case.

## Findings

1. **The run (verified by experiment, both versions).** `queueSlowSuite` takes every slow file that is not current (`research/issue-29.md` 4, `slow-tier.ts:647-664` at `6ea14815`). Nothing on main checks the artifact first: `grep -rn precondition src` is empty at `8ec92f9b`. The failures are the issue's shape, scaled down: `ERR_MODULE_NOT_FOUND` for a `dist/` module, plus assertion failures that do not name `dist/`.
2. **The advice (verified by experiment; read in source code).** The quiet line is `slowTierText` (`src/cli/status-wait-lines.ts:124-132`, task 001-282). It counts pending plus not-run slow files and names `run --slow --wait 60000` with no policy input. The issue's step 3, "Follow its advice", matches this line. On main the primer and skill step 4 (`plugins/claude-code/skills/squeal/SKILL.md:15`) tell a policy-off agent to count instead. So on main the agent gets two pointers that disagree: the skill says count, and the wait line names the command.
3. **Affected against unaffected (verified by experiment).** The edit's own checks were quiet and current before any slow file ran. The slow files were "not run" from the `lookup-only` baseline, not from the edit. This is the issue's "distinguish checks required by the edit from unrelated unrun slow files", and it already holds in the scheduler.
4. **Duplicate boundaries (read in source code: board rows, issue states).**
   - #3 (open) and #16 (closed): a slow tier run without its build output → 004-65, running (repair 4). #35's run half is this defect.
   - #29 (open) and #5 (closed): guidance requiring the whole slow tier under policy off → 004-62, done in 0.1.202. #35 on an installed 0.1.199 hits it again, but it does not reach main's skill or primer.
   - #19 (open): a no-edit session held at Stop under policy on → 004-67, done in 0.1.207. #35 has an edit, so 004-67 does not apply.
   - Not covered by any row: the quiet-line pointer (finding 2) and the policy-on docs-edit case (Answers 6).

## Recommendation for Squeal

Treat #35 as two parts. The run without build output is 004-65; cezarion declaring `slow.precondition: {"exists": ["packages/cezar/dist/**"]}` once it lands is the project's half. The guidance is #29/#5 on 0.1.199, plus one residual on main: the policy-independent quiet `status --wait` line. Whether that line should read the policy, and whether a policy-on edit that re-keys no slow file is exempt, are 004 D8/D9 wording and policy decisions for the human. They are not settled here, and no row should be opened without that decision.

## Open questions

1. Should `slowTierText`'s pointer read `stop.requireSlowSuite`, for example ending "not required here; `squeal run --slow --wait 60000` runs them" when off? This is 005's wording and 001's facts, and it is undecided.
2. Under policy on, is an edit that re-keys no slow file exempt at Stop? 004-67's rule is "no revision since registration". Widening it trades the slow tier's guarantee for scoped tasks. Undecided.
3. Should 004-65's skip reason, or D5's note, name the project's build command? The amendment excludes inferring a precondition from `inputs` and names only the precondition. It is not determined whether the reason should carry a command the user writes.
4. Do the Codex, Pi and OpenCode quiet lines match? Not determined, because only the CLI was run. `status-wait-lines.ts` is shared CLI text, so it is likely.

## Sources

- https://github.com/hearsay-tools/squeal/issues/35, /3, /16, /29, /5, /19 (`gh issue view`, 2026-10-18)
- Probe: `probes/issue-35/run.sh`, `overlay/`, `output-0.1.199.txt`, `output-0.1.213.txt`; fixture `probes/issue-3-preconditions/fixture/`
- main `8ec92f9b`: `src/cli/status-wait-lines.ts:124-132`, `plugins/claude-code/skills/squeal/SKILL.md:15`, `plugins/claude-code/dist/cli/squeal.mjs`
- 0.1.199: `~/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs`, `skills/squeal/SKILL.md:15`
- cezarion `463a5bf0`: `squeal.config.json` (`stop`, `baseline`, `inputs`, `nodeTest` `test:package` `slow: true`), `packages/cezar/package.json` `test:package`
- `spec.md` D5, D7–D9 (D8 as amended for 004-65), `status.md`, `tasks/004-65/amendment.md`, `research/issue-3-preconditions.md`, `research/issue-29.md`; `docs/board.md` rows 004-62, 004-65, 004-67, gh-29
