# 017 Lint checks: a project's own ESLint as a live check

## Problem

Squeal tells an agent when a test changes state. Since spec 015 it also tells the agent when a function becomes too complex or loses its tests. It tells the agent nothing about the project's linter. An agent can leave an unused variable, a floating promise or a rule the team forbids, every test still passes, and the agent hears about it only at a commit hook or in CI, long after the edit.

The human (2026-10-24) asked for an ecosystem of "all kind of feedback your agent should be getting live. Tests, quality metrics, linters etc." On 2026-10-26, after two experiments, the human chose the first check that is not a test or a code measure: "First check: ESLint (Recommended)".

The research found it feasible on conditions:

- One check per file per tool, holding the file's whole set of findings, with a fingerprint without lines, gave no false notice over seven typical edits with `tsc`, ESLint and Ruff. One check per finding said "fixed" for an unfixed finding in 3 of 7 edits (016 `research/diagnostic-identity.md`).
- Warm ESLint costs a median 48 ms of CPU per one-file edit in the daemon's thread and 51 ms in a worker thread; started fresh per edit it costs 420 ms. In the daemon's thread, a blocking provider stopped the daemon's timers for 3 s and a throwing one ended the daemon; a worker contained both (016 `research/binding-cost.md`).
- A warm worker gives the CLI's results only with three levels of reload, and the computed config plus package versions is not a sound key: it missed 6 of 12 input changes (`research/eslint-provider.md`).
- The check fits spec 015's code path, not the test path. Sent down the test path, a lint result gave false notices, became a known failure and dropped its file from complexity counting (`research/lint-seams.md`).

## Goals

1. Off by default. With `lint.enabled` unset or `false`, Squeal loads no ESLint, creates no lint store, and every delivery, status and exit code is byte-identical to the release before (D1).
2. When it is on, in a project whose own ESLint 9 or 10 is installed with a flat config, every included file has a lint state, `pass`, `fail`, `pending` or `unknown`, with the revision and key it was linted at (D2, D3).
3. An edit that adds a finding to a file is delivered at the next delivery point as one `FAIL lint` line for that file, naming the findings it added. Fixing the last finding is delivered as `PASS`. An edit that moves, renames or reorders code without changing the file's findings delivers nothing (D2, D8).
4. The replay of 016-33's seven edits with ESLint gives the transitions of 016-33's a-set column, and no false notice (D2).
5. Over 017-01's 200-edit replay on ESLint 9 and 10, every result Squeal stores equals a fresh `eslint` CLI run on the same bytes (D4, D5).
6. A project's ESLint, its config or a plugin that blocks, throws or crashes never stops the daemon's timers and never ends the daemon. The affected files read `unknown` with the reason, and status says so (D3, D9).
7. Results are shared between worktrees by key. A second worktree at the same bytes, config and packages lints nothing again (D5, D6).
8. A lint finding never counts in `Known failures`, never denies a tool call, and blocks Stop only when `lint.blocking` is `true` (D8).
9. Cost: a one-file edit in a project without typed or cross-file rules costs at most 60 ms of CPU at the median in the worker, measured beside the host's load and stated with it. A warm worker holds at most about 350 MB (D10).

## Non-goals

- ESLint 8 and eslintrc configs. They are 18.4% of downloads (`eslint-provider.md` Q1). With ESLint 8 found, status says `Lint: off: ESLint 8 is not supported` and nothing runs. A later row may add it with a package-identity key.
- Other linters and type checkers (Ruff, Biome, oxlint, `tsc`). They follow once this check's store, key and surfaces have held in dogfood. `tsc` needs its own cost experiment first (the human's options card, 2026-10-26).
- A public provider API for third parties. Spec 016's public half stays deferred (the human, 2026-10-24). The lint provider is internal; its shape informs that later contract.
- Per-finding checks, autofix, and editor-style squiggles.
- ESLint's own `--cache`. Squeal neither reads nor writes `.eslintcache` (`eslint-provider.md` Q5).
- Running ESLint in the daemon's thread, even as a fallback (D3).

## Design

### D1. Policy

A new section in `squeal.config.json` (011 C10), beside `complexity` and `coverage`, read by `daemon/policy-code.ts`:

| Key | Default | Meaning |
|---|---|---|
| `lint.enabled` | `false` | Run the project's ESLint after each revision. Independent of `complexity.enabled` (`lint-seams.md` Q5). |
| `lint.include` | `["**"]`, which narrows nothing | Globs that narrow the files ESLint's own config lints. ESLint's `files`, `ignores` and `isPathIgnored` decide first (amended 2026-10-26, 017-03). |
| `lint.exclude` | `[]` | Globs. |
| `lint.blocking` | `false` | D8. |

The default stays `false` for everyone: turning it on loads and runs the project's own code, ESLint's plugins among it (vision principle 8), and holds about 300 MB per project while on (D10). A rule between keys gets a key-validity case, because the policy loader is on that path (`lint-seams.md` Q5).

### D2. A lint check and its states

A lint check is one file and one tool: `(path, "eslint")`. It is neither a test `CheckId` nor a 015 `CodeCheckId`, so older readers of those tables never meet it (`lint-seams.md` F2.2, F2.3 row 1).

Its outcome is `pass` when the file has no finding of severity error or warning, `fail` when it has at least one, `pending` while Squeal has not linted the current bytes, and `unknown` when it cannot (D9). Warnings count as findings: an agent should hear about them. A project that wants them silent sets them `off` in its own config.

Its failure fingerprint is the sorted multiset of `rule|message` of every finding, with no line and no column (016-33's a-set). The transitions are 015 D5's, plus one:

| Change | Transition | Delivered |
|---|---|---|
| A file linted for the first time, with findings | first-seen fail | yes |
| `pass` to `fail` | `PASS -> FAIL` | yes, with its findings |
| `fail` to `pass` | `FAIL -> PASS` | yes |
| `fail` to `fail`, the fingerprint changed | `FAIL -> FAIL`, changed | yes, with the findings added and removed |
| `fail` to `fail`, the same fingerprint | none | no |
| A file deleted or excluded while `fail` | resolved | yes, once |
| A config or ESLint change | none per file | one summary line (D8) |

A transition compares the new result with the last judged one, which a file keeps through `pending`, `unknown` and `stale`, so `fail`, then `pending`, then `fail` is no first-seen fail. A config, plugin or ESLint change gives no per-file transition; the states still move, and D8's summary line tells it (amended 2026-10-26, 017-03).

The findings added and removed are found in two stages: first by matching the old and new sets on rule, message and the line's text without whitespace, then the findings left over on rule and message alone, so an edit to a failing line's text is not read as one finding removed and one added (amended 2026-10-26, 017-03). The match is evidence only: with two identical findings it can name the wrong one, and the count is still right (`diagnostic-identity.md` Q3). An edit that fixes one finding and adds an equal one in the same file reads as no change (`diagnostic-identity.md` Q3, a known gap).

A finding with no file (a config that does not load, a parser that fails on the config) is no file's check. It makes every file the config covers `unknown` with that reason (D9).

### D3. The provider and its worker

The provider runs in its own `worker_threads` worker, one per project root and resolved ESLint install, started when the first lint is due and kept warm. It never runs in the daemon's thread. A worker that blocks past a guard (5 s per file, then per part) is terminated, its files read `unknown` with `timed out`, and a new worker starts on the next pass, at most 3 times in 10 minutes before the provider stays off with a status line until the next config change. A worker that throws or exits is handled the same way.

Discovery, in the worker (`eslint-provider.md` Q1):

1. Resolve `eslint/package.json` from the project root. None found: status `Lint: off: no ESLint installed in <root>`.
2. Version 8: status `Lint: off: ESLint 8 is not supported` (Non-goals). Version 9 or 10: load it through `loadESLint` and construct `ESLint` with `cwd` set to the project root. A worker cannot `chdir`, so nothing relies on it.
3. Start the worker with `TSESTREE_SINGLE_RUN=false` and the daemon's `ESLINT_USE_FLAT_CONFIG`, which is part of the key (D5).

The core declares the provider once, as data: tool `eslint`, its version, the extensions its config lints, whether it reads the whole program (D5), and its config files. The scheduler asks it nothing per edit (`binding-cost.md` finding 3).

### D4. Reload levels

What a revision changed decides how the worker is refreshed before it lints (`eslint-provider.md` Q3):

| Changed | Refresh |
|---|---|
| Only files ESLint lints | none: the kept `ESLint` instance |
| A config file, or an ignore rule or file | a new `ESLint` instance in the same worker |
| A file the config loaded (a local rule, an imported config), an installed package (011 C11's install fingerprint), a tsconfig, or a keyed environment variable | a new worker thread |

The worker records the config's module closure with a resolve hook when it loads the config, as the observed-inputs recorder does for runners (016 D4), and reports it to the core. The core owns that set.

### D5. Keys

A file's lint result is keyed by `checkKey` over a lint environment (011 C3; `lint-seams.md` F2.1):

- the file's blob;
- ESLint's version and Node's major version;
- the computed config for the file (`calculateConfigForFile`, as JSON);
- the hashes of the config's project-file closure (D4);
- the identities of the installed packages the config loaded (011 C11);
- the keyed environment variables (`ESLINT_USE_FLAT_CONFIG`, `TSESTREE_SINGLE_RUN`);
- the provider's own version.

`calculateConfigForFile` alone missed 6 of 12 input changes (`eslint-provider.md` Q2), so the closure and package parts are not optional.

**Whole-program rules.** A file's findings depend on other files when its computed config has typed signals (`parserOptions.project` or `projectService`) or rules of a known cross-file plugin (`import`, `import-x`; the list is the provider's and grows by row). Such a file's key holds one program segment: the sorted path and blob of every program file, the tsconfig files and TypeScript's version, built once per revision. Never a per-file closure of the program, which would be N × N segments (`lint-seams.md` Q3). So any program edit re-keys every such file.

Linting every such file after every edit would cost seconds of CPU per edit on a large program. So, for whole-program files only:

1. The changed files are linted at once, after the changed program files are fed to the same worker (`eslint-provider.md` Q3).
2. Every other whole-program file whose key moved reads `stale` and is re-linted when the agent is idle, in parts, as 004's slow tier waits for idle. A `stale` file keeps its last outcome in `squeal lint` and counts in status as stale, never as `pass`.

### D6. Storage

A separate SQLite file, `<common-dir>/squeal/lint.sqlite`, with its own `user_version`, created only while `lint.enabled` holds (goal 1). It does not touch `code.sqlite`, whose `user_version` change would cost older daemons their complexity store, nor the main store (`lint-seams.md` F4.3).

- `results`, shared by every worktree and keyed by check and key, as the main store's results, so a rule that reads the path never shares across paths: outcome, findings (rule, message, severity, line, column, line-text hash), fingerprint, ESLint version, linted at.
- `states`, `transitions` and `views`, per worktree, as 015 D4's.

### D7. The pass

A lint pass sits beside 015's code pass in the daemon (`daemon.ts:646`) and takes the same nudges: after each batch, after a listing, at start, and soon after results (`lint-seams.md` Q3). It is not a scheduler lane. One pass at a time.

Each pass:

1. Decides the reload level (D4) from the revision's changed paths.
2. Computes the keys of the included files the revision changed, plus every included file when the config or an input changed.
3. Looks each key up in `results`. A hit is stored as the worktree's state with no lint.
4. Lints the misses in parts of at most 16 files, the files the revision changed first. Whole-program files follow D5's order.

A worktree's first pass looks up every included file and lints the misses, in parts, changed files first, while the agent works. Status shows `Lint: linting, 340 of 600 files.` until it ends.

The worker's CPU takes one slot of the user's run pool (011 C10) while it lints, so lint and tests never together exceed the pool. A part is a one-worker tier: an edit's own files lint under `TierCapacity.running(1)`, the first pass and the idle re-lint under `take(1, "slow", 1, "backlog")`, each released at the part's end (amended 2026-10-26 with 011's coordinator, open question 2).

### D8. What the agent sees

The lines follow 015's code form, after every test block, with 015's cap of 5 entries and `and N more lint changes; squeal lint --changed lists them.` A test failure is always listed first.

```text
FAIL lint: src/a.ts: 2 findings, +1 no-unused-vars ('count' is assigned a value but never used.)
FAIL lint: src/b.ts: 1 finding, +1 @typescript-eslint/no-floating-promises, -1 no-console
PASS lint: src/a.ts: no findings
```

- **Registration.** One line, only when the feature is on: `Lint: 12 files with findings; squeal lint lists them.` While the first pass runs: `Lint: linting, 340 of 600 files.` When off for a reason: `Lint: off: <reason>.`
- **A config or ESLint change.** One summary line once the pass that follows ends: `Lint config changed: 14 files with findings now; squeal lint lists them.` The views are re-seeded by count, as 015 D6's summary.
- **Status.** One line under the code lines: `Lint: 12 files with findings, 2 since this session started, 40 stale; squeal lint lists them.` `--json` adds `lint: { v: 1, files, failing, sinceRegistration, pending, stale, unknown, off? }`.
- **Details.** A new command, `squeal lint [<path>...] [--changed] [--json]`: with no path, every file with findings, newest first, with each finding's rule, message, line and severity; with paths, those files' findings. It reads the store and needs no daemon, as `squeal code` does.
- **Blocking.** A lint failure never denies a tool call and never counts in `Known failures`. With `lint.blocking: true`, Stop's completion check (011 C8) also counts each file that went to `fail` since the consumer registered, as 015 D7 does for complexity.
- **Evals.** `evals/lib/squeal-text.mjs` reads lint lines as code lines, never as test failures. A test feeds it lines from the real formatter, plain and hook JSON, as `test/evals/code-lines.test.ts` does (memory of 0.1.197's B2).

### D9. Errors

| Case | State | Told |
|---|---|---|
| No ESLint installed, or ESLint 8 | lint off | status and registration `Lint: off: <reason>.` |
| The config does not load (syntax, missing plugin) | every file it covers `unknown` | one line per pass while it lasts: `Lint: unknown: eslint.config.js does not load: <message first line>.` |
| A parse error in one file | that file `fail` with ESLint's fatal message as its finding | as a finding |
| The worker times out, throws or exits | the part's files `unknown` | status names the reason and count |
| 3 worker restarts in 10 minutes | lint off until the next config or package change | status `Lint: off: the ESLint worker failed 3 times; <last reason>.` |

### D10. Cost

Measured beside the host's load (`binding-cost.md` Q2; `eslint-provider.md` Q3):

- A one-file edit, warm: about 51 ms of CPU in the worker at the median (p10 to p90: 29 to 99 ms) for ESLint's core rules on one file of 236 lines. Larger files and heavier plugins cost more; dogfood states it.
- A config change re-lints every included file: about 10 to 12 s of CPU for 200 files.
- A new worker thread (D4 level 3) pays ESLint's load again: about 360 to 390 ms of CPU, plus the config's plugins.
- Memory: about 290 to 320 MB per warm worker on the research fixture with one typed rule. Without typed rules it is likely less (open question 1).

## Testing

- Unit: the fingerprint, the transitions and the added/removed match, on the replay of 016-33's seven edits (goal 4).
- Integration, with ESLint 9 and 10 installed as dev dependencies for tests only (the coordinator's call; they are not runtime dependencies): the 200-edit replay of 017-01 compared with a fresh CLI run at each step (goal 5); each D4 reload level; each D5 key part re-keys its file; the D9 cases; a plugin that blocks, throws and exits (goal 6).
- Off by default: with no `lint` section, a session's deliveries, status and exit codes are byte-identical to the release before, and no `lint.sqlite` appears (goal 1).
- Two worktrees: the second lints nothing at the same key (goal 7).
- The evals parser on real formatter output (D8).
- End to end: a real session in the e2e suite with a fixture project that lints with ESLint 10.
- Dogfood: a repository that lints with ESLint 9 or 10 and has typed rules (open question 5), with the cost per edit and per worker stated with the host's load (goal 9).

## Open questions

1. How much of a warm worker's memory comes from TypeScript's project service, and whether a project without typed rules needs much less. Owner: the dogfood row.
2. Resolved 2026-10-26 with 011's coordinator: a lint part is a one-worker tier of the user's pool (`tasks/wave-1.md`, 017-05). No bound of its own.
3. Which plugins besides `import` and `import-x` read other files (Vue, Next, route plugins). Owner: a research row before the list grows.
4. In a monorepo with several ESLint installs, whether one worker per install is right, and its memory. Owner: the dogfood row.
5. Which repository dogfoods it: this one lints with Biome. Owner: this spec's coordinator, before the proof wave.

## References

- The human's decision: `status.md`, 2026-10-26.
- Research: `research/eslint-provider.md` (017-01), `research/lint-seams.md` (017-02); 016 `research/diagnostic-identity.md` (016-33), `research/binding-cost.md` (016-34), `research/check-protocol-judgment.md`, `research/plugin-mechanisms.md`.
- Specs: 011 C3, C4, C5, C8, C10, C11, C14; 015 D1 to D7; 016 D4; 004 (the slow tier's idle wait).
