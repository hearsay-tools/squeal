# 019-33 notes: dogfood Round 2

Worker 7de9ed74, 2026-11-04, 05:18Z to 06:15Z. The results are in `../../lessons.md`, "Round 2 (019-33)". These notes are the residue: how the round ran, where the raw data is, and what to know before a Round 3.

## Setup

| Item | Value |
| --- | --- |
| OS user | `squeal-e2e` (uid 1002). Every clone, install, daemon, CLI run, hook run and model session ran as that user through Round 1's `../019-17/bin/as-e2e.mjs`, cwd `/`. Credentials by name only: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` for Claude Code; `CLIPROXY_API_KEY`, `CODEX_CA_CERTIFICATE` for Codex. |
| Case root | `/home/squeal-e2e/runs/d1933`: `home`, `tmp`, `claude`, `codex`, `xdg`, `corepack`, `bin`, `pin`, the clones `cezarion` and `fixture`; `pnpm-store` links to Round 1's (`d1917`), so cezarion's install took 8 s and fetched nothing. |
| Scratch | `/tmp/dogfood-019-33`: `bin/` (Round 1's scripts, then this folder's, readable by the e2e user), `bundles/`, `fixture-src/`, `bases.json`, `codex-catalog.json` (Round 1's), `logs/`. |
| Squeal | `git archive 636d2088f` (main at 0.1.400) of both plugins, the Codex runtime and both marketplace manifests, each marketplace renamed `hearsay` (`bin/setup.sh pin install`). `squeal --version` printed 0.1.400; `claude plugin list` showed `squeal@hearsay` 0.1.400 at user scope. |
| Codex trust | `bin/setup.sh trust`: `squeal init --harness codex --trust --yes` in the fixture on `fix-h2` (so init finds `squeal.config.json` and writes nothing): all ten hooks of `squeal@hearsay` were untrusted, then trusted, both Stop handlers among them. |
| Repositories | cezarion from Round 1's bundle (`10e7a5782`), the fixture from `make-fixture.mjs` with a 15 s e2e file (commit `f5dad60`). Branches by `bin/configs.mjs` (Round 1's, commit messages renamed) and `bin/setup.sh control` (`fix-none`). `npm install` in the fixture leaves an untracked `package-lock.json`; each session's `git clean -fdq` removes it before the daemon starts. |

## Scripts (`bin/`)

| Script | What it does |
| --- | --- |
| `setup.sh` | Steps `dirs`, `pin`, `bundles`, `clone`, `deps`, `install`, `configs`, `control`, `trust`. |
| `configs.mjs` | Round 1's, with `dogfood 019-33:` commit messages. |
| `session.mjs <id>` | Round 1's runner with Round 2's sessions: every session stops the clone's daemon and removes its store first; `pre: "partial"` (s2) writes `notes.md` and the partly staged `src/math.ts`; cezarion settles with `squeal status --wait 90000`; it also saves `git-status.txt` and `log.txt` with `--stat`. |
| `memloop.sh` | Round 1's, reading this round's scratch. |
| `p3probe.mjs <trials> <lead ms>` | P3 with news, no model (lessons, "Probes"). |
| `symlink.sh <fix-h1 commit> <link\|file>` | P11's symlink guess, no model. |
| `update.sh <fix-h1 commit>` | When a commit line's update comes, no model (P9). |

The probes run as the e2e user: `node ../019-17/bin/as-e2e.mjs /home/squeal-e2e/runs/d1933 /home/squeal-e2e/runs/d1933/fixture sh /tmp/dogfood-019-33/bin/<probe>.sh <args>`; `p3probe.mjs` calls `as-e2e.mjs` itself.

Per session, in `/tmp/dogfood-019-33/logs/sessions/<id>/` while the host keeps `/tmp`: `stream.jsonl` (each line stamped with epoch ms), `timeline.txt`, `meta.json` (load, memory, times, s2's `preStatus`), `mem.jsonl`, `store.json`, `status-before.txt`, `status-after.txt`, `settle-before.txt`, `diff.patch`, `log.txt`, `git-status.txt`, `stderr.txt`, and for Codex `codex-rollout.jsonl`. Also `logs/p3/*.jsonl` (each trial, with each entry's text), `logs/symlink.txt`, `logs/update.txt`, `logs/cleanup.txt`.

## Session order

s3a, s3b, s3c, s1f, s2, s5, s5b, s3b2, s3b3, s3b4 (05:19Z to 05:33Z), the P3 probe (05:34Z to 05:47Z), s1c (05:49Z), the symlink probe, s4 (05:56Z), cleanup (05:59Z), the update probe, s6 (06:04Z), cleanup (06:04Z).

## What went wrong, and how it was handled

- **s3b's first hold was the 2 s entry's.** Not planned for: the fix of P3 shipped. s3b2 to s3b4 repeated s3b to measure how often; none recurred, because those agents batched their edits and the first Stop had no news. The difference between s3a (news, the record came) and s3b (news, no record) led to the probe.
- **The probe's first control was not faithful.** A variant that told the news before Stop (to stand for s3b2) ended with no hold in 12 of 12 trials: the 2 s entry said nothing in 0.15 to 0.25 s, and the waiting entry said nothing after 0.9 to 4.7 s, where s3b2 to s3b4 held after 15 s. In the one trial read from the store, a `flow.test.ts` run of the edit's revision started before Stop, so the probe's consumer probably read as paused; this was not resolved. Adding the UserPromptSubmit and PreToolUse hooks did not change it. The variant was dropped (its rows are `logs/p3/dropped-*.jsonl`); the start order (`lead`) is the probe's control instead, and s3b2 to s3b4 are the real no-news control.
- **cezarion's settle returned in 26 to 29 s, not at its 90 s bound.** `squeal status --wait 90000` without paths returned with 1,214 of 1,220 files not current. Enough here: the daemon had listed its files and the baseline was queued, which is what s1c and s4 needed.
- **P11's cause was not found.** The time box went to one guess (a symlink, refuted by `symlink.sh`). The store keeps no list of the commit line's not-determined files; `differingPaths` (`src/core/commit/compute.ts`) with the daemon's hash cache decides them. A next step: in s1c's state, compare each test file's key inputs with `git ls-tree` of the commit.

## For the next worker

- `p3probe.mjs` is the cheapest check of a P10 fix: `node bin/p3probe.mjs 4 150` should give no `block` from the 2 s entry.
- The update of a commit line comes at a test tier's record or the next 30 s pass (P9); a probe or test of P8 must wait for it, or fix P9 first.
- cezarion on a new store keeps about 1,000 unit files queued for the whole session; an edit there gets its first run 14 to 24 s after its revision.
