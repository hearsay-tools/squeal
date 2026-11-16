# Research brief for spec 023: results at a commit

Read `docs/vision.md`, `docs/styleguide.md`, `docs/process.md`, `../status.md` and the first finding, `../../018-ci-and-shared-results/research/results-at-commit.md`, first. Extend it; do not repeat it.

The human, 2026-11-16, chose one slice: `squeal status --at <commit>` (name a draft) reports per test file the result at that commit, "no result" or "not determined", and with a flag Squeal itself makes a temporary checkout of the commit, installs it, runs the missing test files within a budget (020 D3's runner), writes them to the shared store at that commit's keys, removes the checkout and prints the before/after comparison. Retention stays 7 days.

Each topic is one researcher task. Findings to `research/<topic>.md` in this folder; probes under `research/probes/<topic>/`. Commit when done.

## Rules for findings documents

- 1 to 4 pages: Questions answered (a table), Findings per question, Recommendation, Open questions for the human, Sources.
- Tag every finding `verified by experiment`, `read in official docs`, `read in source code` or `inferred`. Name the commit you read.
- Stores: read-only (`VACUUM INTO` a copy in `$TMPDIR`). Experiments in clones under your own `$TMPDIR`; never the main checkout or another worktree. No full suite, no `squeal run --all`; bound each test run with `timeout 600`. Stop every daemon you start and remove every worktree you add. State the one-minute load average beside every timing; do not add load on purpose. Run no `evals/bin` script.

## Topic: temp-checkout (row 023-01)

What it costs and what breaks to run missing test files at commit X in a temporary checkout.

1. Install time, disk and network for a detached `git worktree add` at a recent main commit plus a frozen install, on this repository (pnpm), on squawk (`~/projects/cezar`, clone it into `$TMPDIR`, read-only on the original) and on one npm fixture under `test/fixtures` or a small public npm project. Warm and cold package cache.
2. Which tests at X need files git does not hold (a build, generated files; squawk's `packages/cezar/dist`, 788 paths). How a project could declare a build step, and what Squeal says when none is declared.
3. Global setup and shared resources (ports, databases, containers, fixed temp paths) in the two repositories: what collides when the checkout runs beside the user's tree. What 020's gate already warns about (D14.4).
4. Where the checkout lives, how the store learns of it (worktree row, keys under X), and how an interrupted run is cleaned up (`squeal ps` sweep, cezar's own worktree cleanup as a reference).
5. Whether 020 D3's runner can run inside that checkout unchanged (no daemon, budget, completed files kept); what it needs.
6. Recommend the run flow, its default budget and what stays out of the first slice.

## Topic: environment-at-commit (row 023-02)

When X's lockfile, runner config, setup files or Node pin differ from this worktree's, the first finding reports "not determined". Can Squeal compute X's keys anyway?

1. Per environment input (`src/core/keys/environment.ts`, `environment-hash.ts`, `dependencies.ts`): can it be derived from git objects at X (the lockfile instead of `node_modules/.pnpm/lock.yaml`; the config file's text instead of the loaded config), and would the key stay exact? Name each input that cannot.
2. Recording each environment hash by the commit a daemon saw it at: rows, bytes, and the share of "not determined" files it would resolve on this host's stores over the last 7 days.
3. After a temp-checkout install (topic 023-01), is the environment hash there equal to the one a daemon at X would compute? Verify on two commits with differing lockfiles.
4. Machine inputs (Node version, platform): confirm they stay this machine's and that results under another Node are misses by design.
5. Recommend: derive, record, install-to-know, or "not determined" only; with the share of files each recovers.

## Topic: glob-membership (row 023-12, 2026-11-16)

The wave 1 review failed twice on 023-03 (`../reviews/wave-1.md` B1, `../reviews/wave-1-rereview.md` B1). A module that uses `import.meta.glob` (or a template-literal `import()`) loads the files a pattern matches on disk. The closure lists the matched files, but nothing in the key says "depends on which files exist in that folder". At commit A `plugins/` holds `kept.ts` and `old.ts`; at B `old.ts` is removed and nothing else changes. B's closure omits `old.ts`, every listed file is byte-identical, so a key computed over B's list at A equals B's key, and B's pass would be reported for A. The daemon covers adds in memory (spec 001 D4 `invalidate` rule 3, `src/runners/vitest/dynamic.ts`, `stale.ts`), and spec 001 D3 already keys observed directory listings as `dir/` entries. The human, 2026-11-16: land what passed, research the cause. The 023-03 code waits on branch `cez/4a59bc1d` (`990b60650`).

1. Does the same gap reach results outside 023: a result reused in another worktree, a CI import (018), or the daemon after a restart, when a file matching a glob was added or removed? Reproduce with the real Vitest adapter on a `$TMPDIR` fixture, or show from source why not.
2. Fix A, the cause: the closure records a listing entry (`dir/`, recursive where the pattern is) for each glob a module expands, so the key changes when a matching file appears or goes. Where it would be recorded (Vitest adapter, closure), what it costs (re-keys only files with globs?), whether it needs a key-format raise and what that re-runs once (memory: a release must not re-key every check unless meaning changed; `test/keys/key-format.test.ts`).
3. Fix B, the cheap rule for 023 only: keys at a commit read `not determined (closure)` for any test whose closure holds a module whose source at either commit matches `DYNAMIC_SPECIFIER`. Which other resolution inputs (aliases, `tsconfig` paths, `package.json` `exports`/`imports`, resolution candidates) can change a closure with no byte change in listed files, and does fix A or B cover them?
4. Frequency: test files whose closure holds such a module, in this repository's and squawk's stores (read-only copies), and the share of main commits where a matching file was added or removed.
5. Recommend A, B, both, or another single owner, with the numbers.

Findings to `research/glob-membership.md`; probes under `research/probes/glob-membership/`. Read-only on stores and other checkouts; no full suite; `timeout 600` on direct runs; no daemon left running.
