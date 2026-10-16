# Probe: issue 7, `why` under store contention

Throwaway. Research only, for `research/issue-7.md`; nothing here is product
code or a test. Every script works on a scratch repository and a scratch HOME
under `/tmp`, never on a live shared store or the real HOME.

- `setup.sh <scratch> <squeal.mjs>`: a git repository with a node:test project
  (two tests named after issue 7's queries), `squeal init`, then `squeal warmup`,
  so a real daemon stores real results.
- `hold.mjs <store> <mode> <ms>`: holds one lock on the store (`immediate`,
  `exclusive`, `exclusive-locking`, `read`).
- `attempt.sh <scratch> <squeal.mjs> <mode> <ms> [check]`: one controlled
  `squeal why` 100 ms into a hold, then one after the release.
- `trace-open.mjs <store>`: replays `openStore`'s statements one at a time.
- `upgrade.mjs <store>`: `results.byKey`'s no-row UPDATE alone and inside a
  read transaction.
- `live.sh <scratch> <squeal.mjs> <n>`: a real daemon validates an edit every
  0.5 s while `why` runs n times.
- `run-all.sh <scratch> <squeal.mjs>`: every controlled attempt; its output
  for 0.1.200 (`23f276c2`) and installed 0.1.199 is `logs/run-all.txt`.

Reproduce:

```sh
S=$(mktemp -d /tmp/issue7-XXXX)
CLI=$PWD/plugins/claude-code/dist/cli/squeal.mjs
sh setup.sh "$S" "$CLI" && sh run-all.sh "$S" "$CLI"
(cd "$S/repo" && HOME="$S/home" node "$CLI" stop); rm -rf "$S"
```
