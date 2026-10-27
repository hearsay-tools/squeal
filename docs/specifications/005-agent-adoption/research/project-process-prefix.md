# Project first in process commands

Recommend a project-and-role `argv0` at Squeal's owned Node spawn sites, starting with daemon creation. It fixes btop's Command prefix without changing discovery or retention. It does not cover every runner child.

Research for 005-87, 2026-10-27. Source: `9a30611c3247a859b87e99461cd6e2d1484f1b0f`, Squeal 0.1.366. Linux; Node 22.19.0 and 24.21.0; Vitest 5.0.3; Python 3.12.3; btop 1.3.0. [Probe and results](probes/project-process-prefix/README.md). No product changes, build, product suite, or subject agents.

| Question | Answer | Evidence |
| --- | --- | --- |
| 1. Prefix, discovery, retention, Node versions and display | Works on both Nodes. Actual `discover()` accepts the prefixed process. Actual `keepVersion()` keeps an active old copy and removes it after exit. btop's Command column starts with argv0. | verified by experiment [E, UI]; read in source code [B] |
| 2. Coverage and title replacement | Daemon and directly owned Node helpers have a spawn seam. Node test children and Vitest forks do not inherit argv0. Vitest 5 retains an explicitly supplied fork prefix. Python needs separate treatment. Hooks and the launcher have no Node spawn-options seam. | verified by experiment [E]; read in source code [S1–S5] |
| 3. Bounded implementation | Add a display-label helper and an argv0 option at daemon creation. Extend only explicit owned Node sites. Keep runner grandchildren, Python, hooks and launchers as named limits. | inferred from [E, S1–S5] |

## 1. What the probe establishes

**Verified by experiment, Node 22.19.0/24.21.0 [E].** Both runs exit 0. A prefix such as `squeal cezarion@work-1 daemon` is one argv element, even with spaces. `/proc/<pid>/cmdline` and `ps -ww -o args=` start with it. The script, `daemon`, root with spaces, `--await-lock`, and its value remain separate, unchanged elements. A Node flag also remains intact. `process.argv`, `execPath`, `execArgv`, and `/proc/<pid>/exe` preserve their original meanings. `process.argv0` and the initial `process.title` getter reflect the prefix. No `process.title` assignment occurs. Linux `comm` stays `node` on 22 and `MainThread` on 24.

This goes beyond the precondition simulation in `process-names.md`. The probe calls the product's `createProcSource()` and `discover()` on the real fixture PID. It checks the script, root, worktree id and lock-wait value, for a real main checkout and linked worktree. It also calls the actual `ensureDaemonProcess()` against the idle fixture, adding only argv0 at the spawn boundary in memory. The detached child remains discoverable. No daemon/store service is started; lock-holder phase, sockets, handoff and shutdown are not exercised.

The retention check calls the actual `keepVersion()` in a temporary plugin-data directory. Version 0.1.1 remains active while 0.1.2 and 0.1.3 exist. All copy directory times are older than the 24-hour grace period. Creating 0.1.3 preserves 0.1.1 because its original script path remains in `ps`. After exit, creating 0.1.4 removes 0.1.1. This tests real pruning, not a copied predicate. The installer's separate pruning implementation was read, not run [S2].

**Read in official docs, Node 24.21.0 [N].** Node documents that `process.argv[0]` is replaced by `process.execPath`; `process.argv0` retains the supplied launch value. Thus preserving JS argv does not mean every process-observable field stays unchanged.

**Read in source code, btop 1.3.0 [B].** This matches `btop --version` on the host. Linux collection joins NUL-separated `cmdline` elements in order, with a 1,000-character cap. Normal view draws `p.cmd` left-aligned and truncates its right end. The prefix therefore comes before the retained plugin path. The separate Name column still comes from `comm`. A narrow tree view uses `short_cmd`, and the Command column can disappear when space is insufficient. No macOS or Windows claim is made.

**Verified by experiment, installed btop 1.3.0 [UI].** A three-second PTY check at 160 columns in normal process view rendered the fixture PID, `MainThread`, then `squeal cezarion daemon -e ...` in its row. The saved result contains only that fixture row. This verifies the actual Command prefix; narrow/tree views remain source-only limits.

## 2. Practical coverage

**Read in source code, Squeal 0.1.366, except experiment rows [E].**

| Process | Exact seam and limit |
| --- | --- |
| Daemon, including successor | `src/core/daemon/ensure.ts:217`, `spawn(process.execPath, [cli, 'daemon', root, ...lockWait], options)`. It already has authoritative `root` and resolved `commonDir`. Keep the pinned `cli`, executable, cwd, detached flag and arguments. Existing discovery filters need no changes. |
| Integrity helper | `src/core/daemon/full-check.ts:70`, `runFullCheck(database)`. An argv0 option can precede its long `-e` script. Its caller has `commonDir`; pass a display label explicitly rather than deriving a project from the daemon's temporary cwd. The check serves a repository store, so a repository label is sufficient. |
| OpenCode bridge | `src/harness/opencode/bridge-client.ts:91`, `callBridge(..., cwd, ...)`. Node child can receive argv0. The caller runs in Bun; Bun behavior was not probed. Use the session/worktree root already resolved by the host. The bundle permits only `node:child_process` here, so pass a computed label into this seam instead of importing Git/filesystem logic. |
| node:test leader | `src/runners/node-test/run/run.ts:179` calls `startGroup`; `src/runners/process/group.ts:38` owns spawn. An optional argv0 passed only by the Node caller can name the leader from `options.root`, not runner `cwd`. **Verified by experiment:** its isolated test child uses the real Node executable as argv0, so the prefix does not reach that child. |
| Vitest | `src/runners/vitest/adapter.ts:217` creates Vitest in the daemon. Threads share that process. Vitest 5.0.3's fork constructor at `dist/chunks/index.DpLw24bj.js:11096` sets no argv0. **Verified by experiment:** one-file forks do not inherit the parent prefix. A diagnostic patch supplying argv0 at that actual fork survives worker startup and test execution. No `process.title` setter occurs in the installed Vitest JS. The patch is evidence, not a proposed global spawn override. Other versions/pools were not verified. |
| pytest | `src/runners/pytest/run/run.ts:194` uses the same group function. **Verified by experiment:** on Python 3.12.3, replacing argv0 makes `sys.executable` empty instead of `/usr/bin/python3`. The probe runs Python, not pytest. Do not apply a shared default prefix to Python. Virtual environments remain untested. |
| Claude/Codex hooks and waiter | Launched externally from `hooks.json`, through Node or the existing `hooks/run` exec wrapper. An already-running JS entry cannot set OS argv0 with spawn options. A shell/bootstrap change would need separate portability, session-root and trust analysis. Codex's hook command text is trusted; do not change it in this slice. |
| CLI/data launcher | `plugins/claude-code/bin/squeal-launcher:31` execs one Node with inline version selection. JS rewriting `process.argv` does not rewrite OS argv. POSIX `sh` has no portable `exec -a`; changing shells or re-executing Node is a different scope. Direct `squeal daemon` invocations bypass `ensureDaemonProcess`. |
| Embedded hosts and arbitrary children | Pi's worker is a thread in Pi; OpenCode plugin code runs in its host. Do not rename either host. Do not prefix Git, package managers, user commands under `squeal hold`, or arbitrary children tests spawn. |

## 3. Implementation boundary for the coordinator

**Inferred recommendation [E, S1–S5].** The smallest useful row owns one new display-label helper, `src/core/daemon/ensure.ts`, and narrow tests. Use a bounded label with the project first, then the role, then a short worktree suffix if needed, for example `squeal cezarion daemon @a1b2c3`. Set it only through `spawn`'s argv0. Keep every original argument after argv0 and every runtime path. No identity registry or `comm` filter change is needed.

The helper should take the existing resolved root and common directory. For a conventional shared `<project>/.git`, the parent basename gives the project across linked worktrees. `worktreeIdFor(root)` already gives a canonical-realpath id; a short display suffix distinguishes worktrees without exposing a long generated directory name. For separate Git directories, submodules or unreadable layout, use the known worktree basename as a fallback; do not claim the common-directory basename is a project name. Do not add a Git subprocess on the hook path [S4].

Bound each label component before joining it, so a long project cannot hide the role. Replace whitespace/control characters and terminal escapes with safe printable ASCII separators; provide a nonempty fallback. This normalization affects display only. Never normalize the root argument or use the label as identity. Short suffixes can collide. Exact caps and fallback text need the coordinator's spec; they were not tested here.

Optional follow-on seams are the integrity helper and bridge, then the node:test leader with its coverage limit stated. Full runner coverage needs a runner-owned launch option or supported pool integration. Do not add a global child-process patch or change runner isolation just for a monitor label. The process-observable argv0/title change also needs consideration under 011 C11's fidelity rule, especially for Vitest config/globalSetup running inside the daemon.

Required narrow regressions: both supported Nodes with flags and spaces; main/linked worktrees and hostile/long display names; actual discovery with legacy/prefixed children; retained active copy older than 24 hours; unchanged executable/script selection and `--await-lock`; no prefix on Python, embedded hosts or user commands. If helpers are included, test their launch boundary and failure paths. Keep existing hook trust hashes unchanged. A later implementation still needs ordinary candidate review and bundle regeneration.

## Evidence and limits

- [E] [Reproducible probe and both result files](probes/project-process-prefix/README.md). These are isolated experiments, not a passing product-suite claim. See that README for final verification output.
- [UI] [Bounded installed-btop probe](probes/project-process-prefix/monitor.py) and [rendered row](probes/project-process-prefix/result-btop.json), exit 0.
- [S1] `src/core/daemon/ensure.ts:199–235`; `src/core/ps/discover.ts:34–57,142–176`; `src/core/ps/reads.ts:14`; spec 014 D2.
- [S2] `src/harness/shared/version-copies.ts:128–167,225–272`; `install.sh:346–351`; spec 005 D3 and its retained-copy amendments.
- [S3] Owned spawn sites in the coverage table; `src/core/ps/processes.ts:142–152` still recognizes runner script/flag arguments. Runner attribution itself was read, not invoked by the probe.
- [S4] `src/core/fs/git-layout.ts`, `resolveCommonDir`, `findWorktreeRoot`, `worktreeIdFor`; spec 011 C8/C9.
- [S5] Hook declarations, `plugins/claude-code/hooks/run`, `plugins/claude-code/bin/squeal-launcher`; prior [process-names.md](process-names.md). No new harness session or trust write.
- [B] Fetched matching btop tag: [Linux collection, lines 2518–2538](https://github.com/aristocratos/btop/blob/v1.3.0/src/linux/btop_collect.cpp#L2518), [normal/tree drawing, lines 1845–1867](https://github.com/aristocratos/btop/blob/v1.3.0/src/btop_draw.cpp#L1845), [left alignment, lines 326–339](https://github.com/aristocratos/btop/blob/v1.3.0/src/btop_tools.cpp#L326).
- [N] Fetched [Node 24.21.0 child_process docs](https://nodejs.org/download/release/v24.21.0/docs/api/child_process.html#child_processspawncommand-args-options), JSON version, spawn's argv0 explanation.
