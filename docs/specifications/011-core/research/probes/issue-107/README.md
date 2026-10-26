# Probes for research/issue-107.md (throwaway)

Throwaway. Nothing here is product code or a test. Findings: `../../issue-107.md`.

## E1: a globalSetup's detached server outlives `squeal stop`

`fixture/` has the shape of cezarion's e2e project: one Vitest project whose `globalSetup` starts `server.mjs` detached, in its own process group, cwd the root, output to `.ai/qa/test-env-app.log`. Its teardown only logs. `squeal.config.json` makes `e2e/*.e2e.mjs` a slow file.

```sh
sh run.sh <squeal-worktree>
```

The script copies `fixture/` to `/tmp/issue107-*/repo` and links `<squeal-worktree>/node_modules` there for Vitest. It runs `HOME`, `XDG_*`, `TMPDIR`, `CODEX_HOME` and `PLUGIN_DATA` under the clone and unsets `PLUGIN_ROOT`, `PLUGIN_DATA`, `CLAUDE_PLUGIN_*` and the `SQUEAL_*` markers. It runs `<squeal-worktree>/plugins/claude-code/dist/cli/squeal.mjs` at nice 10 to do `start`, `run --slow --wait`, `stop` and `stop` again. After each step it prints the server's state, parent, group, cwd, `SQUEAL_*` names and `TMPDIR`, with the one-minute load. At the end it kills only the server it started (checked by cwd) and removes the clone. It runs one test file. Output of the 2026-10-26 run (17:51Z, load 15.7): `e1-2026-10-26.out`.

## E2: survey of the host's cezarion fixture servers (read-only)

```sh
sh survey.sh
```

The script reads `/proc` only: cmdline, stat, cwd, and env variable **names**. It never reads a value, never signals, and never opens a store or socket. For each `.ai/qa/build/cezar/dist/index.js --repo …` process it prints its age, root and parent, and its watcher's cwd. The watcher's cwd is the `os.tmpdir()` of the booting process. The script also prints the Squeal scratch key of the root and whether the two match, and whether a Squeal daemon for the root is live. Output at 17:51Z: `e2-2026-10-26.out`.

## E3: the watcher's idle stop

Wait for a surviving server without signalling it, then read its watcher's log:

```sh
P=<server pid>; for i in $(seq 1 120); do [ -d /proc/$P ] || break; sleep 10; done; date -u
tail -2 <root>/.ai/qa/test-env-watch.log   # "watcher stopping cezar pid <P>: idle 30 minutes"
grep -h "stopping cezar" <cezar>/.ai/cezar/worktrees/*/.ai/qa/test-env-watch.log | sed 's/pid [0-9]*//' | sort | uniq -c
```
