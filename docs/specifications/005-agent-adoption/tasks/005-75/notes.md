# 005-75 notes: one Node start per command through the launcher

Worker notes, 2026-10-22, with 005-74. Brief W2 in `011-core/tasks/wave-12.md`; spec 005 D3, the launcher; `reviews/0.1.247.md` S1.

## What changed

- `plugins/claude-code/bin/squeal-launcher` (the one source since 005-76) now ends in `exec node --disable-warning=ExperimentalWarning -e '<lookup>' "$0" "$@"`. The lookup is the same code as before. At its end it picks `dist/cli/ps.mjs` for `ps` (that test moved from the shell into the lookup), sets `process.argv[1]` to the CLI, removes `-e <lookup>` from `process.execArgv`, and imports the CLI. The CLI sees the same `argv` and `execArgv` as with `node --disable-warning=ExperimentalWarning <cli> <args>`.
- 005-74: the lookup chooses `run` (the newest install, or a kept copy of that version or newer) before it writes the harness-skew notice. The notice names `run.version`.
- Every CLI since 0.1.62 runs `main` at the top level of `squeal.mjs`, with no `process.argv[1]` or `import.meta.main` gate. So the launcher can import any installed version.

## Format line: raised from 5 to 6

The raise is in 005-74's commit, and 005-75 uses the same raise. `squeal update` replaces `~/.local/bin/squeal` only when an installed plugin's launcher has a higher format (`src/cli/update.ts` `recopyLauncher`). Without the raise, a terminal launcher that is already installed keeps two Node starts and the wrong notice. `<PLUGIN_DATA>/bin/squeal` needs no raise: SessionStart rewrites it when its text differs (`src/harness/shared/version-copies.ts` `writeLauncher`). The update tests moved their format numbers by one, as 014-33 did for format 5.

## Process count

- Test: `test/cli/launcher.test.ts`, "starts Node once, and the CLI sees the process as `node <cli>` would give it". A `node` on the scratch PATH logs each start. With format 5 the test failed with 2 starts; with format 6 it passes with 1.
- Real CLI (0.1.256 Codex cache copied into a scratch HOME, the same logging `node` first on the PATH): `squeal --version` through format 5 made 2 Node starts, through format 6 made 1.

## CPU per `squeal --version`

Scratch HOME with only the 0.1.256 Codex plugin. The four commands ran interleaved 40 times each. CPU is user + sys from `/usr/bin/time` (10 ms resolution). Load average 21 to 17 on 24 cores, 2026-10-22 09:24.

| Command | Median | Min | Max |
|---|---|---|---|
| `node -e 0` | 0.050 s | 0.050 s | 0.070 s |
| `node squeal.mjs --version` (the CLI alone) | 0.110 s | 0.100 s | 0.130 s |
| launcher format 5 | 0.180 s | 0.160 s | 0.240 s |
| launcher format 6 | 0.115 s | 0.100 s | 0.150 s |

Three rounds of 20 runs each at load 25 to 27 (from `/proc/<pid>/stat` child times) gave the same order: format 5 at 0.186 to 0.241 s, format 6 at 0.119 to 0.163 s, the CLI alone at 0.118 to 0.174 s. The launcher now costs about 5 ms of CPU more than the CLI alone (at the timer's resolution), where it cost about 70 ms more. Spec D3 still says "about 85 ms more per call than the CLI alone (005-05, question 1)". That text is for the coordinator to amend.

## Behaviour checked to stay the same

- Arguments and exit codes go to the CLI unchanged (`--version` and `-e` after `$0` go to the CLI, not to Node). The existing launcher tests pass.
- A CLI that throws when it loads: the stderr and exit 1 are the same as with format 5. Only one internal Node stack frame differs (`importModuleDynamicallyWrapper` instead of `asyncRunEntryPointWithESMLoader`).
- `squeal start` through format 6 in a scratch git repo spawned the daemon as `node <cache>/0.1.256/dist/cli/squeal.mjs daemon <root>`, from the CLI's path, not the launcher's. `squeal stop` stopped it, and no process remained.
- With the three copies overwritten from the source for one run (restored afterwards, not committed), these test files pass: `launcher.test.ts`, `opencode/package.test.ts`, `node-floor.test.ts`, the evals cell tests that copy the Codex launcher. Total 136 tests.

## What a reader of the process table now sees

A CLI command run through the launcher now shows in `ps` as `node --disable-warning=ExperimentalWarning -e <lookup> <launcher> <args>`. Before, it showed the CLI's own path. The cmdline is fixed when the process starts, and `process.title` would also rename `comm`, which `squeal ps` matches (`MainThread`, `node`). So the CLI's path cannot be put back without a second start.

- Daemons do not change. `squeal start` spawns them from `process.argv[1]`, which is the CLI's path. `squeal ps` finds them as before (`src/core/ps/discover.ts`, `<script> daemon`).
- `install.sh` `in_use` and the copy pruning (`version-copies.ts` `processArgs`) keep a version whose `<dir>/` a running process's arguments name. A long CLI command through the launcher (`run --all --wait`, `status --wait`) no longer protects its own version. The risk is small: the launcher runs the newest version, and a prune keeps the current version and the newest previous one. A second update during the command is needed, and the command's code is already loaded.

## Not done here

- The Codex, Pi and OpenCode copies of the launcher: the build writes them (005-76). Their identity tests in `launcher.test.ts` fail in this tree until the coordinator rebuilds.
- `install.sh` copies the launcher as before; nothing in it changed.
- The bundles and the version.
