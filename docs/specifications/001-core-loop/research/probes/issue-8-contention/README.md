# issue-8-contention probes (throwaway)

Throwaway fixtures for `../../issue-8-contention.md`. Not product code; nothing imports them. Every script refuses a store path outside `/tmp/` and none ever touches a live shared store.

- `register.mjs`, `ts-hook.mjs`: let Node 24's type stripping import `src/*.ts` (rewrites `.js` specifiers), so `seed.mjs` uses the baseline's own store API with no `npm ci`.
- `seed.mjs <dir>`: `git init` a disposable repo and seed its store with one failing check, `src/auth.test.ts > auth > login`.
- `hold.mjs <db> immediate|exclusive|lockmode <ms>`: hold one lock mode on the disposable store.
- `matrix.sh <repo> <ms> name=cli.mjs...`: `why` and `status --json` during and after each hold, per CLI bundle.
- `variants.sh <repo> <ms> <cli.mjs>`: every `why`/`status`/`failures` form while a normal writer holds `BEGIN IMMEDIATE`.
- `lastclose.mjs`, `lastclose.sh <repo> <mb> <cli.mjs>`: grow an un-backfilled WAL, close the last connection (SQLite checkpoints under an exclusive file lock), run `why` every 150 ms across it.
- `crash.sh <repo> <mb> <k> <cli.mjs>`: `lastclose.mjs ... crash` SIGKILLs the writer with the WAL in place; k `why` calls then open at once (WAL recovery).
- `keeper.mjs <db> <ms>`: an idle connection standing in for a live daemon.
- `churn.mjs`, `churn.sh <repo> <n> <cli.mjs>`: 4 looping writers, a looping `integrity_check` reader and a keeper, while `why` runs n times, or n at once with `burst`.

Run from this directory, for example:

```
node --disable-warning=ExperimentalWarning --import ./register.mjs seed.mjs /tmp/i8/repo
./matrix.sh /tmp/i8/repo 3000 baseline=$PWD/../../../../../../plugins/claude-code/dist/cli/squeal.mjs \
  0.1.199=$HOME/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs
```

`results.txt` holds the output of the runs the report cites. Delete `/tmp/i8` afterwards.
