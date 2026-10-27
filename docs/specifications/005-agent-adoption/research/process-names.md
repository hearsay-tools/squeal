# Readable Squeal process names

Recommend Linux short names for Squeal-owned processes, with matching `squeal ps` support; keep launch arguments and version selection intact.

Research for 005-86, 2026-10-27. Product source: `4b1b41b1043f824020e9f55b4ea50095dc08bfb1`, Squeal 0.1.366. Experiments: Linux 6.8.0-147-generic, Node 22.19.0 and 24.21.0. Scope: source reading and the [isolated probe](probes/process-names/README.md). No product changes, builds, suites or subject sessions.

| Question | Answer | Evidence |
| --- | --- | --- |
| 1. Which commands make long lines? | Hooks exec Node with absolute bundle paths. The terminal/data launcher embeds its resolver in `node -e`; that code stays in the OS command line even after it imports the CLI. Daemons and bridges name absolute entries. The integrity-check child embeds another script. | read in source code, Squeal 0.1.366 [S1–S3] |
| 2. Launcher or title? | A shell launcher that execs Node leaves Node's display. `process.title` changes both `comm` and command-line bytes. Linux `comm` alone changes the short name and preserves arguments. | verified by experiment, Node 22.19.0/24.21.0 [E] |
| 3. What breaks? | A short title removes paths used for retention and arguments used by `squeal ps`. Changing `comm` alone still needs its name filters updated. PATH lookup can select another plugin or unrelated executable. | read in source code, Squeal 0.1.366 [S1, S4–S6]; title effects verified by experiment [E] |
| 4. Smallest safe change? | Name only Squeal-owned Linux main processes through `/proc/self/comm`; accept their exact names in process discovery and waiter checks. Keep the current invocation route. | inferred from [E, S1–S7]; requires the regressions below |

## 1. Launch map

**Read in source code, Squeal 0.1.366.** The relevant paths are:

- Claude Code: `hooks/hooks.json` invokes plugin-local `hooks/run`, which checks the per-tool fast path and then `exec "$@"`. Arguments are `node --disable-warning=ExperimentalWarning <plugin>/dist/<hook>.mjs`. The async waiter uses `dist/waiter.mjs`. `bin/squeal` separately execs the adjacent CLI or `ps` bundle. No extra shell stays between hook and harness after exec [S1].
- Codex: hook declarations contain one command string with the absolute expanded `${PLUGIN_ROOT}/dist/<hook>.mjs`. Per-tool commands have a shell fast path. Registration keeps versioned runtime copies. `kept.ts` supplies their CLI path for later daemon spawns [S1, S4].
- Terminal/data launcher: `bin/squeal-launcher`, copied to the user's bin or plugin data bin, runs its resolver in one `node -e` process. It selects installed/retained versions, rewrites JS `process.argv[1]` to the selected CLI, removes the eval flags from JS `execArgv`, and imports that CLI. It does not exec a second Node. Thus its long resolver source remains in OS argv [S2].
- Daemon: hook `src/harness/shared/ensure.ts` delegates to `src/core/daemon/ensure.ts:217`, which spawns `process.execPath`, `[cli, "daemon", root, ...lockWait]`, detached. The CLI comes from the pinned hook/copy, or the explicit `SQUEAL_CLI` override. Daemon selection uses store records, version comparison, socket identity and the lock [S3].
- Other owned work: OpenCode spawns Node plus its bridge entry, sometimes with a data-URL preload (`bridge-client.ts`). `full-check.ts:70` spawns `node -e <SQLite integrity script> <database> <limit>`. Pi's `worker.mjs` is a worker **thread inside Pi**, not a separate process. Runners launch Vitest workers, node:test and pytest; these keep their own runtime and runner identities [S3, S7].

## 2. Display probe

**Verified by experiment, Node 22.19.0 and 24.21.0.** Both seven-case runs exited 0. Full readings are [Node 22](probes/process-names/result-node22.json) and [Node 24](probes/process-names/result-node24.json).

| Method | Linux `comm`, Node 22 / 24 | OS argv and path retention |
| --- | --- | --- |
| Direct Node | `node` / `MainThread` | Six separate arguments; runtime path present |
| Shell executable named `squeal`, then exec Node | `node` / `MainThread` | Same as direct |
| Node executable symlink named `squeal-node` | `squeal-node` / `MainThread` | Six arguments; path present; Node 22 fails current name filter |
| Spawn with `argv0: "squeal"` | `node` / `MainThread` | First argument is `squeal`; other arguments stay separate; current discovery preconditions pass |
| `process.title = "squeal daemon"` | `squeal daemon` / same | One argument; runtime path gone; discovery preconditions fail |
| Title with original script and args joined | `squeal /home/ag` / same | Path remains, but one argument; discovery still fails |
| Write `squeal-daemon` to `/proc/self/comm` | `squeal-daemon` / same | Six original arguments and path remain; discovery passes when the exact name is accepted |

In every case JS `process.argv`, `argv0`, `execPath` and `execArgv` stayed unchanged across the naming operation. A child launched with `process.execPath` still used the real Node executable and did not acquire its parent's title. `/proc/<pid>/exe` stayed the real Node executable. The project argument contained spaces, so flattening then splitting a title is not a safe way to recover argv.

**Read in official docs, Node 24.21.0.** Node says setting `process.title` “overwrites the `argv` memory of the process”; Linux/macOS length is limited to the binary name plus arguments. It warns that Activity Monitor and Windows Services Manager may not show the assigned label. `process.argv0` preserves the launch value; `process.argv[0]` is `execPath` [D1].

**Read in source code, htop 3.3.0 and btop 1.3.0.** htop reads `cmdline`, `comm` and `exe`; its merged Command display can include the short name, while an unmerged command view can show only argv. A COMM column also exposes the name. btop reads `comm` as the process name and `cmdline` as the command (up to 1,000 characters), when it first caches the process. Thus the proposed name improves the name view; it does **not** shorten the full command. Set it early. A btop process cached before naming may need a monitor restart. No rendered UI, macOS or Windows behavior was verified [D2, D3].

## 3. Compatibility constraints

**Read in source code, Squeal 0.1.366.** `version-copies.ts:225–272` and `install.sh:346` search `ps -A -o args=` for `<version-directory>/`. Retention keeps active copies in addition to the newest previous copy; Codex also keeps copies made within 24 hours. That grace period does not protect an older active copy indefinitely. Short titles would remove its evidence [S4].

`src/core/ps/reads.ts:14` accepts only `node` and `MainThread`. `discover.ts:142` then requires a separate `daemon` argument after a recognized CLI script and reads root/lock-wait arguments. `flags-processes.ts:77` uses the same name filter and a waiter-script argument. A title containing all paths still collapses the argument boundaries. Runner attribution also reads Vitest paths, `--test` and pytest args. Do not title runner processes or Pi's host [S5, S7].

Stop and orphan cleanup use process start times, groups and `SQUEAL_DAEMON_CHILD` marks for identity; command lines also supply diagnostic text. Hook registration walks ancestor names past shells. Preserve exec replacement: a new persistent Node launcher parent could be mistaken for the harness. No source reviewed makes short display names a substitute for identity [S6].

**Inferred from S1–S6.** Bare PATH `squeal` is unsuitable for hooks: it may be absent, user-shadowed or the global newest-version selector. A plugin-local entry can preserve version provenance, but a shell wrapper alone does not change the resulting display. Replacing Codex hook command text also changes its trusted declaration hash (002 D1); a source-only naming change leaves that declaration intact. Display naming must not alter the retained-copy manifest check, daemon CLI choice or step-down rules.

## 4. Proposed implementation boundary and regressions

**Inferred recommendation.** Add one best-effort Linux helper that writes a fixed ASCII role name of at most 15 bytes to `/proc/self/comm`. Use `squeal`, `squeal-daemon`, `squeal-hook`, `squeal-waiter`, `squeal-bridge` and `squeal-check`. Do nothing on other platforms or on an unavailable `/proc`; naming must not fail a hook. Call it only at owned executable entries, never in shared handlers that run inside a harness. Keep argv, executable paths and launchers as they are. Extend the daemon and waiter name filters with the exact appropriate names while keeping old Node names and all argument/UID/lock checks. This is smaller than adding a second process-identity registry to make short titles safe.

Proposed owned files: a new `src/core/process-name.ts`; `src/cli/index.ts` and `ps-index.ts`; the two hook `main.ts` files; OpenCode `bridge.ts` at `runEntry`; `src/core/daemon/full-check.ts` for its inline child; `src/core/ps/reads.ts`, `discover.ts` and `flags-processes.ts` for exact role acceptance. A later product row must regenerate bundles through the normal reviewed build. No launcher or hook-declaration change is needed for this name-view improvement.

Required regressions: (1) real tiny child on both supported Node lines, argv/execPath/child behavior and proc fields as above; (2) named and legacy daemon discovery, including waiting/stopping daemons, spaces in root and `--await-lock`; (3) named/legacy waiter detection and unrelated-process negatives; (4) retention of an active copy older than 24 hours across two newer versions; (5) unchanged Codex trust hashes, manifest/version choice and hook parent identity; (6) unavailable proc/non-Linux no-op and no rename of Pi/OpenCode hosts or test runners. Extend `test/ps/{discover,flags-processes}.test.ts`, `test/harness/shared/version-copies.test.ts`, launcher/hook tests and full-check tests as appropriate. These are proposed tests, not runs made by this research.

Optional separate change: `argv0: "squeal"` at owned spawn sites makes the command start with Squeal without flattening arguments; it does not set the Node 24 short name or remove paths. If the requirement is a completely short **full command** in every monitor mode, this recommendation does not meet it. That needs a separately specified replacement for retention/discovery evidence before using short titles. Calling syntax, short process name and full command display are three different surfaces.

## Sources and verification

- [E] [Probe and recorded outputs](probes/process-names/README.md). Both Node runs exit 0; `node --check` and the staged `git diff --check` exit 0. `squeal status --wait 60000` on the report and probe exits 3: no test closure covers either path; revision 9, zero known failures, 1,039 of 1,265 files unknown. The direct isolated probe supplies this task's verification. No product suite was run or claimed to pass.
- [S1] `plugins/{claude-code,codex}/hooks/hooks.json`, `plugins/claude-code/hooks/run`, `plugins/claude-code/bin/squeal`; spec 002 D1/D3 and spec 011 C8.
- [S2] `plugins/claude-code/bin/squeal-launcher:31,138–143`; spec 005 D3/D6 and its status amendment log.
- [S3] `src/harness/shared/ensure.ts`, `src/core/daemon/ensure.ts:200–250`, `src/core/daemon/full-check.ts:33–80`; spec 011 C9.
- [S4] `src/harness/shared/version-copies.ts:213–272`, `src/harness/codex/kept.ts`, `install.sh:346–351`.
- [S5] `src/core/ps/{reads,discover,flags-processes,processes}.ts`.
- [S6] `src/core/daemon/{terminate,leftovers,escaped,outlived}.ts`, `src/harness/shared/harness-process.ts`.
- [S7] `src/harness/opencode/{bridge-client,bridge}.ts`, `src/harness/pi/{worker,entries/extension}.ts`, `src/runners/process/group.ts`.
- [D1] Fetched [Node 24.21.0 process docs](https://nodejs.org/download/release/v24.21.0/docs/api/process.html#processtitle), JSON paragraphs for `title`, `argv`, `argv0`.
- [D2] Fetched [htop 3.3.0 LinuxProcessTable.c](https://github.com/htop-dev/htop/blob/3.3.0/linux/LinuxProcessTable.c#L1098), lines 1098–1228; [Process.c](https://github.com/htop-dev/htop/blob/3.3.0/Process.c#L324), merged-command logic and `TASK_COMM_LEN` comment.
- [D3] Fetched [btop 1.3.0 btop_collect.cpp](https://github.com/aristocratos/btop/blob/v1.3.0/src/linux/btop_collect.cpp#L2518), lines 2518–2539. These monitor versions match the installed binaries; no interactive monitor test was run.
