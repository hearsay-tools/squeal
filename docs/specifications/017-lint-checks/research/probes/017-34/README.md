# Probes of row 017-34 (throwaway)

Throwaway. These scripts produced the numbers in `../../lint-gate-stall.md`. They only read. They open `lint.sqlite` and `store.sqlite` with `readOnly: true` and read `logs/daemon-*.log`. They start no daemon, run no test and make no load beyond the read. Run with `nice`. They are not product code and are not tested.

Run on 2026-11-27 between 19:40Z and 20:50Z, Node 26.13.0, over the squawk repository's Squeal directory on this host (`<squawk>/.git/squeal/`). Every other repository on this host with Squeal has `lint.enabled` false, so squawk is the whole lint sample.

| Script | Reads | Gives |
|---|---|---|
| `stall.mjs <repo>/.git <out.json>` | each worktree's `lint-keying`, `lint-inputs` and `lint-cpu-wait` records; its lint states; the `linted_at` of the results its states were judged on; the revision its keying ran at; its daemon log `daemon-<worktree id>.log` | one JSON row per worktree: the last keying, its cause, the lint parts after it, the waits of 10 s or more between them, and the log's refusal episodes |
| `analyze.mjs <out.json>` | the JSON | full re-lints before and after 0.1.570: completion times, waits, logged and unlogged, causes |
| `eps.mjs <out.json>` | the JSON | refusal episodes in every log by format, and the open `lint-cpu-wait` records |
| `more.mjs <out.json>` | the JSON | lint rate, and how long daemons lived with a re-lint left unfinished |
| `env.mjs <lint.sqlite> <out.json>` | cursor environments | whether a first keying missed after another worktree at the same environment had finished |
| `envdiff.mjs <lint.sqlite> [since]` | `lint-inputs` records | what differs between consecutive lint environments |

The output JSON is not committed: it holds worktree paths.
