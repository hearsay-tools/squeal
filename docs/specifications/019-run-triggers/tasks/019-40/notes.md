# 019-40 notes: dogfood Round 3

Worker 8eaf72d1, 2026-11-04, 10:09Z to 10:40Z. The results are in `../../lessons.md`, "Round 3 (019-40)". These notes are the residue: how the round ran, where the raw data is, and what to know before a Round 4.

## Setup

| Item | Value |
| --- | --- |
| OS user | `squeal-e2e` (uid 1002). Every clone, install, daemon, CLI run, hook run and model session ran as that user through Round 1's `../019-17/bin/as-e2e.mjs`, cwd `/`. Credentials by name only: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` for Claude Code; `CLIPROXY_API_KEY`, `CODEX_CA_CERTIFICATE` for Codex. |
| Case root | `/home/squeal-e2e/runs/d1940`: `home`, `tmp`, `claude`, `codex`, `xdg`, `corepack`, `bin`, `pin`, the clones `cezarion` and `fixture`. pnpm 11 keeps its store under `$HOME/.local/share/pnpm`, not `npm_config_store_dir`, so `home/.local/share/pnpm` links to Round 2's; cezarion's install fetched nothing. |
| Scratch | `/tmp/dogfood-019-40`: `bin/` (Round 1's scripts, Round 2's, then this folder's, readable by the e2e user), `bundles/` (Round 2's two, copied), `bases.json`, `codex-catalog.json` (Round 1's), `logs/`. |
| Squeal | `git archive 64ed7667e` (main at 0.1.401) of both plugins, the Codex runtime and both marketplace manifests, each marketplace renamed `hearsay` (`bin/setup.sh pin install`). `squeal --version` printed 0.1.401; `claude plugin list` showed `squeal@hearsay` 0.1.401 at user scope; the Codex data folder's `runtime/current.json` names 0.1.401. |
| Codex trust | `bin/setup.sh trust`: all ten hooks of `squeal@hearsay` were untrusted, then trusted, both Stop handlers among them. |
| Repositories | cezarion at `10e7a5782` and the fixture at `f5dad60`, from Round 2's bundles. Branches by Round 2's `configs.mjs` (its commit messages still say `dogfood 019-33:`): `cez-groups` `c0b07168`, `fix-h1` `945c56c8`, `fix-h2` `9de930ca`. |

Steps run: `sh bin/setup.sh dirs pin bundles clone`, `deps`, `install configs trust`; at the end `cleanup`.

## Scripts (`bin/`)

| Script | What it does |
| --- | --- |
| `setup.sh` | Round 2's steps for this case root and pin, plus `cleanup` (`squeal stop` in both clones, `mem.mjs`, `ps -u squeal-e2e`). |
| `session.mjs <id>[-<n>]` | Round 2's runner with Round 3's four sessions (`s1c`, `s1f`, `s3n`, `s5n`); a `-<n>` suffix repeats one under its own log folder. From s1c-2 on, every session also runs `reports.mjs`, which writes `reports.jsonl`. |
| `memloop.sh` | Round 2's, reading this round's scratch. |
| `reports.mjs <clone> <stop file>` | Every 250 ms, the stored commit reports, told marks, lint keying and lint cursor, each change with epoch ms. Read only. |
| `keying.sh <seconds>` | A second commit in cezarion's daemon after s1c, no hook: keying, cursor, report and status lines over time. |
| `sync.sh <seconds>` | A commit, then at once `squeal status --wait 2000` (a sync, as a boundary asks), in cezarion's daemon after s1c-2: when the report and its update are stored. |
| `lintstore.mjs <clone>` | The lint store's tables and meta rows, read only. After s1f and s1c it showed P12. |
| `envmove.sh <cez-groups commit>` | A new store in cezarion, settled as s1c, the same edit and commit: the lint keying, cursor and keyed inputs after the settle, the edit and the commit, and the input blobs that differ. It stops its daemon and resets the clone at the end. |

Run the probes as the e2e user: `node ../019-17/bin/as-e2e.mjs /home/squeal-e2e/runs/d1940 /home/squeal-e2e/runs/d1940/cezarion sh /tmp/dogfood-019-40/bin/<probe>.sh <args>`, after `setup.sh dirs` has copied them to the scratch `bin/`.

Per session, in `/tmp/dogfood-019-40/logs/sessions/<id>/` while the host keeps `/tmp`: `stream.jsonl` (each line stamped with epoch ms), `timeline.txt`, `meta.json` (load, memory, times), `mem.jsonl`, `reports.jsonl` (s1c-2 only; added after s1c), `store.json`, `status-before.txt`, `status-after.txt`, `settle-before.txt`, `diff.patch`, `log.txt`, `git-status.txt`, `stderr.txt`, and for Codex `codex-rollout.jsonl`. Also `logs/keying.txt`, `logs/sync.txt`, `logs/envmove.txt`, `logs/cleanup.txt`.

## Session order

s1f (10:11:30Z), s3n (10:14:37Z), s5n (10:16:09Z), s1c (10:18:23Z), `keying.sh` (10:22:46Z), s1c-2 (10:26:46Z), `sync.sh` (10:30:41Z), `envmove.sh` (10:32Z to 10:34Z), cleanup (10:34:22Z).

## What went wrong, and how it was handled

- **s1c's report time was not stored.** The stored report keeps one `at`, overwritten by its update, so s1c could not say when the first version was stored. s1c-2 repeats s1c with `reports.mjs`; it is a fifth session, beyond the brief's four.
- **The probes ran above the gate.** The host's load rose from 11 to 34 to 44 after s1c-2, from other work. The gate is for sessions; `sync.sh` (34.6) and `envmove.sh` (37.2) ran then, and their times are read as an order of events, not as costs.
- **`envmove.sh` saw no first keying.** At that load no lint keying had been written at the settle or 6 s after the edit, so the diff compares the commit's keying with nothing recorded. s1c-2's sampler shows the first keying (−3.79 s) and the edit keying (13.44 s) before the `config` one. The cause is read from the code with that diff.
- **The lint finding's missing line (P12) was found after s1f**, by reading the lint store before the next session removed it. `squeal lint` showed the finding; the `transitions` and `views` tables were empty.

## For the next worker

- P12 decides whether lint at `commit` is useful to an agent: until a commit's finding is told by name, the agent only guesses what `lint 1 finding` means.
- A cezarion session on a new store measures the cold store as well as Squeal: its first pass after an edit waits about 14 s. To measure P8 with no hold, warm the daemon first.
- `ProviderSession` is per daemon process, so P13 may repeat at each daemon start; the next probe should restart the daemon on a kept store and read the keying.
