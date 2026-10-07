# Daemon lifetime under harnesses, and reused worktree paths

Research task 001-66 for spec 001, 2026-10-07. Linux only (kernel 6.8, Node v24.21.0, git 2.43.0, systemd 255). Probe: `probes/daemon-under-harnesses/` (throwaway). Repository at `bd576a7`; `ensure.ts` and `scratch.ts` as of 001-63 (`05343c9`).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Who starts the daemon in a Cezar worker; does it leave the spawner's group and session? | A Squeal hook inside the worker's `claude` process. Yes: the daemon leads its own process group and session and is reparented to `systemd --user` as soon as the hook exits. It stays in the harness's cgroup. | verified by experiment, read in official docs, read in source code |
| 2 | Does Cezarion's cleanup track it? Claude Code's? `git worktree remove`? | Cezarion: only through a scan of every process's working directory (`/proc/*/cwd`) under the worktree and task scratch. It has no group, session, cgroup, descendant or open-file tracking, and never signals a process it did not record. Claude Code and git: no process check at all. | verified by experiment (Cezarion scan, git); read in source code (Cezarion 0.15.1-dev.1436); read in official docs (Claude Code 2.1.292, git 2.43.0) |
| 3 | With 001-61 and 001-63, what still pins a worktree, and is it Cezar-only? | The daemon itself pins nothing. What is left: a runner call in flight (seconds to 10 minutes), and a tool child such as esbuild's service under Vite 6/7 (until the daemon exits). Both block only a harness that refuses to remove a directory a live process sits in. Of the harnesses examined, only Cezar does that. On this host, defect 13 still reproduces because the installed plugin predates both fixes. | verified by experiment (stand-in daemon); read in source code; observed on this host |
| 4 | Can two repositories reuse one worktree path within the old daemon's exit window? | Not under Cezar, Claude Code's default layout, or GitHub-hosted runners. It is possible with generic patterns: a script that reuses one fixed worktree path across repositories, sibling `../<name>` paths from repositories in one parent directory, and Claude Code's own `WorktreeCreate` example, which puts worktrees under `$HOME`. Rare, but not contrived. Codex and Conductor: not determined. | read in official docs, read in source code, inferred |

## Findings

### 1. Who starts the daemon, and where it ends up

- **Start.** `ensureDaemon` (`src/core/daemon/ensure.ts`) runs from the plugin's SessionStart, UserPromptSubmit, PostToolBatch and Stop hooks. It calls `spawn(process.execPath, [cli, "daemon", root], { cwd: <common-dir>/squeal, detached: true, stdio: "ignore" })`, then `unref()`. *Read in source code.*
- **Node v24.21.0 docs, `options.detached`:** "On non-Windows platforms, if `options.detached` is set to `true`, the child process will be made the leader of a new process group and session." *Read in official docs.*
- **Probe.** The chain is controller, then hook, then stand-in daemon (`probes/daemon-under-harnesses/output.txt`). The stand-in had pid = pgid = sid. Its ppid was 1269002 (`systemd --user`, a subreaper) by the time it first wrote its ids. A SIGKILL to the controller's whole process group left it alive. Its cgroup was the controller's: `…/app.slice/cezar.service`. *Verified by experiment.*
- **Live, on this host.** This worktree's real daemon (pid 2195057) has pgid = sid = 2195057 and ppid 1269002, in `cezar.service`'s cgroup. The worker's `claude` (2194913) has pgid 1970036, which is `cezarion serve`'s group. Cezarion spawns `claude` without `detached` (`core/claude-cli-runner.js:83`). *Observed (read-only `/proc`).*
- **cgroup consequence.** `cezar.service` has `KillMode=control-group` (`systemctl --user show`). systemd.kill(5): "all remaining processes in the control group of this unit will be killed on unit stop". So stopping or restarting the service kills every daemon a Cezar session started. The OS then releases each lock, and the next daemon of each worktree empties its temp directory (D10). This is harmless, and it applies to any harness run as a systemd unit or in a container. *Read in official docs; inferred for the consequence.*

### 2. What each cleanup tracks

**Cezarion** (`delegation/process-liveness.js`, `delegation/service.js`, `runs/store.js`, `workflows/run.js`):
- The process record holds only the agent pid(s) (`recordWorkerProcess` on `onPidChange`). Stop is `child.kill('SIGTERM')` on that pid, escalating to SIGKILL. Orphan reaping signals "recorded, token-verified survivors … Scan-only processes are never signalled." So no Cezarion code path signals a Squeal daemon; only a systemd unit stop does (section 1). *Read in source code.*
- Worker destroy calls `workerResourceHolders`, then `inspectGeneration({ paths: [worktree, ...agentTmpDirLocations] })`. The only scan is `scanCwd`: `readlink /proc/<pid>/cwd` (or `lsof -d cwd` on macOS), matched against those paths. It reads no open files, process group, session, cgroup or descendant tree. A match makes destroy return `incomplete` ("processes … may still hold the worker worktree or scratch"). That is the message in defect 13. *Read in source code.*
- **Probe**, calling Cezarion's own `processesWithCwdUnder` with a `since` cutoff as `holdersSince` does. A stand-in with cwd at the root (the plugin before 001-61) is reported as a holder before and after teardown. A stand-in with cwd at `<common-dir>/squeal/` (after 001-61) is not reported: `[]` after teardown. *Verified by experiment.*
- **Task scratch.** A top-level task's scratch is removed when the run is terminal, with no holder scan (`reapTerminalScratch` calls `removeAgentTmpDir`). A worker's scratch waits for the cwd scan. Neither looks at open files. So a daemon whose `TMPDIR` was the scratch lost its Vitest temp directory under a live instance, which is defect 12's shape. 001-63 moved `TMPDIR` to `/tmp/squeal-<uid>/tmp/<hash>/`, which closes this. *Read in source code; inferred for defect 12.*

**Claude Code 2.1.292** (docs, `/docs/en/worktrees`): on exit, the decision to remove a worktree rests on "changed or untracked files, uncommitted work inside checked-out submodules, and new commits". Subagent worktrees are removed "when the subagent finishes without changes". A periodic sweep removes background and subagent worktrees older than `cleanupPeriodDays`. Locks are taken "so that concurrent cleanup can't remove it". `-p` runs are never cleaned up. Running processes are not mentioned anywhere. *Read in official docs; not verified by experiment.*

**git 2.43.0** (`git help worktree`, `remove`): "Only clean worktrees (no untracked files and no modification in tracked files) can be removed." In the probe, `git worktree remove` without `--force` exited 0 while the stand-in's cwd was inside the worktree. The stand-in's cwd became `… (deleted)`. *Verified by experiment.*

### 3. What still pins a worktree after 001-61 and 001-63

| Behaviour | Holds the root? | Who it blocks | Cezar-only? |
|---|---|---|---|
| Idle daemon | No: cwd `<common-dir>/squeal/`, temp dir under `/tmp/squeal-<uid>` (D10; stand-in probe) | nobody | n/a |
| Runner call in flight | Yes: the daemon and Vitest's workers have cwd = root, for up to `runner.timeoutMs` (10 min) | a harness that refuses on cwd holders. Cezar returns `incomplete`, and a retry after the run succeeds | yes, of those examined |
| Tool child started during a run (esbuild service, Vite 6/7) | Yes, until the daemon exits (D10, B2 option (b)) | same as above. Under Cezar the daemon never sees its worktree removed, so destroy waits for the idle exit, at least 60 minutes after the last consumer | yes, of those examined. Neither `cezar` (Vite 8.1.4) nor this repo (Vite 8.3.2) runs Vite 6/7 |
| `git worktree remove`, Claude Code cleanup | n/a: they remove regardless. The daemon exits within one check (at most 5 s, `lifecycle.ts:64`) and its children die with it | nobody | n/a |
| A daemon in the harness's cgroup | No | nobody; a unit stop kills it, which is safe | no |
| **The installed plugin on this host** | **Yes.** `~/.claude/plugins/installed_plugins.json` pins `squeal@squeal` to `cfb8e9e`, before 001-61. Its bundle still spawns with `cwd: root`. All 15 live daemons on this host have cwd = their worktree root (checked twice during this task), and this worktree's daemon has `TMPDIR` = the Cezar task scratch | Cezar destroy, exactly as in defect 13 | deployment, not code |

### 4. Who names worktree paths so that two repositories can share one

| Tool | Path scheme | Two repos, one path? | Tag |
|---|---|---|---|
| Cezar | `<repo-root>/.ai/cezar/worktrees/<runId>` (`git-worktree.js:66`), run id a `randomUUID()` | Never: the path contains the repository's own root and a UUID | read in source code |
| Claude Code `--worktree`, subagents | `<repo-root>/.claude/worktrees/<name>`; a generated name such as `bright-running-fox` | Never in the default layout | read in official docs |
| Claude Code `WorktreeCreate` hook | Anything. The docs' own example uses `$HOME/.claude/worktrees/$NAME` | Yes, if two repositories use one name | read in official docs |
| `git worktree add` | No default: `<path>` is required; the docs' example is `../project-feature-a` | Yes, for a fixed absolute path, or `../<name>` from repositories with one parent directory | read in official docs |
| Codex app | `$CODEX_HOME/worktrees`, one root for all repositories; naming not documented | not determined, because the docs do not give the directory naming | read in official docs |
| Conductor | `~/conductor/workspaces/<repo name>/<workspace name>` | not determined, because naming and reuse after archive are not documented. The repository *name* is in the path, so same-name repositories share the parent | read in official docs |
| GitHub-hosted runner | `/home/runner/work/<repo>/<repo>`, fresh VM per job | Never | read in official docs |
| Self-hosted runner | `_work/<repoName>/<repoName>`. The owner is dropped (`TrackingConfig.cs`, actions/runner v2.338.0), so `alice/app` and `bob/app` share it | The path, yes. But at job end the runner kills every new process that carries the job's `RUNNER_TRACKING_ID` (`JobExtension.cs:589,891-929`, on unless `process.clean` is false). The daemon inherits it (D11), so it is dead before the next job | read in source code, inferred |

Reachability: B1 needs the second repository's worktree and daemon to appear while the first daemon lives, at most one 5 s check after the removal. A script that loops over repositories with one fixed worktree path and runs an agent with the plugin in each does exactly that. Such a script removes and re-adds within a second. So B1 is reachable outside a probe, though rarely, and never under Cezar. *Inferred.*

A related case, from reading `lifecycle.ts` and `open.ts`, not probed: a repository deleted and re-created at the same path within one check interval (`rm -rf repo && git clone … repo`) keeps the same common-dir path. The old daemon does not see its root vanish. It holds its lock on an unlinked file, so a new daemon wins a new lock file at the same path. The two then share a temp directory just as in B1. A key built from the common-dir *path* plus the root would not separate them. *Inferred.*

## Recommendation for Squeal

**001-65: fix, at low priority.** B1 is not a Cezar case: Cezar cannot hit it. Any harness or script that reuses a worktree path across repositories can. The harm is a stored, inheritable `FAIL` with no note, which breaks goals 3 and 4. The fix is a key change plus one test.

The tradeoff is a third round on a slice that has had two, against a known silent wrong result. Parking would make sense only if the slice's churn costs more than a rare false failure. I think that is the wrong way round under "everything the agent is told is true". The fix brief should state whether a repository re-created in place is in scope (above). If it is, the key needs an identity that survives a re-clone at the same path, not the common-dir path alone. Nits N1 and N2 were outside these questions.

**Defect 13: nothing left to do in Squeal code.** After 001-61 and 001-63 the daemon holds nothing inside the root or the spawner's `TMPDIR`. Cezarion's own scan does not see it (probe). git and Claude Code never looked.

What remains:
- **The installed plugin.** Update it from `cfb8e9e` to a build at or after `05343c9`. Then close defect 13 once a Cezar worker destroy goes through without `squeal stop`.
- **Holder-refusing harnesses.** Runner calls and Vite 6/7 tool children still block such a harness. That is a policy only Cezar has among those examined. D10 already tells such a harness to run `squeal stop` first. That step belongs in Cezar, or in the coordinator's destroy routine.

Changing Squeal further would shape it around one harness. It would also put back the risk B2 option (b) avoided: configs and tests resolve paths against the working directory (goal 3).

## Open questions

1. Does Claude Code run `SessionEnd` when Cezar SIGTERMs a stream-json `claude`? If not, a worker's consumer lasts until the 12 h expiry rather than the 10-minute waiter rule, which applies only to interactive sessions. A daemon holding a Vite 6/7 child would then block Cezar's destroy for about 13 h, not about 60 minutes. Not determined, because it needs an attended Cezar destroy with a fresh plugin.
2. Codex and Conductor directory naming, and whether either checks for running processes before deleting. Not determined, because their docs do not say.
3. The re-created-in-place case above is inferred from source, not probed.
4. macOS: Cezarion uses `lsof -d cwd` there, so it has the same cwd-only semantics. Nothing was verified on macOS.

## Sources

- Squeal: `src/core/daemon/ensure.ts`, `scratch.ts`, `lifecycle.ts:55-95`; `spec.md` D10; `lessons.md` defects 12 and 13; `reviews/wave-7.7.md` B1.
- Node v24.21.0 `child_process`, `options.detached`: https://nodejs.org/docs/v24.21.0/api/child_process.html
- Cezarion 0.15.1-dev.1436, `/home/agent/.nvm/versions/node/v24.21.0/lib/node_modules/cezarion/node_modules/@wjarka/cezarion/dist/`: `delegation/process-liveness.js` (`scanCwd`, `inspectGeneration`), `delegation/service.js:680-760`, `delegation/workspace.js:278-420`, `runs/store.js:3278-3306`, `workflows/run.js:805-905, 2628-2640`, `runs/agent-tmpdir.js`, `core/claude-cli-runner.js:78-90, 184-230`, `git-worktree.js:66`.
- Claude Code 2.1.292 worktrees: https://code.claude.com/docs/en/worktrees
- git 2.43.0: `git help worktree` (`add`, `remove`).
- Codex worktrees: https://learn.chatgpt.com/docs/environments/git-worktrees (redirected from developers.openai.com/codex/app/worktrees)
- Conductor: https://www.conductor.build/docs/concepts/git-worktrees, https://www.conductor.build/docs/concepts/workspaces-and-branches
- GitHub Actions variables (`GITHUB_WORKSPACE`): https://docs.github.com/en/actions/reference/workflows-and-actions/variables
- actions/runner v2.338.0: `src/Runner.Worker/TrackingConfig.cs:51-68`, `src/Runner.Worker/JobExtension.cs:588-600, 889-935` (https://github.com/actions/runner/tree/v2.338.0)
- systemd 255: `systemd.kill(5)` `KillMode=`; `systemctl --user show cezar.service`.
- Host observations: `/proc/<pid>/{stat,cwd,cgroup}` of live daemons, read-only; `~/.claude/plugins/installed_plugins.json`.
