# Issue 81: a Codex catalog skill path that an update deletes

Date: 2026-10-23. Issue: https://github.com/hearsay-tools/squeal/issues/81. Related: closed [#48](https://github.com/hearsay-tools/squeal/issues/48), `issue-48.md`, `plugin-cache-cleanup.md`, spec 005 D3 and D6, spec 002 D1. Versions: Squeal checkout 0.1.276 (`ed9c18b64`), installed Codex plugin 0.1.275 then 0.1.276, Codex CLI 0.160.1 (from the session log). Time box: 20 minutes.

Verdict: **reproduced.** A live Codex session's catalog skill path disappears during an update, while the saved skill copy and the stable launcher survive. This is a recurrence of a gap that 005-73 left on purpose, not a regression of 005-73. The real session also did not get the saved-skill line, because no SessionStart text reached it.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Can the catalog path disappear while the saved skill and launcher survive? | Yes. After Codex's install of the next version, the catalog path gives `No such file or directory`, the saved copy `<PLUGIN_DATA>/versions/<old>/skills/squeal/SKILL.md` reads, and `<PLUGIN_DATA>/bin/squeal` exists. | Verified by experiment (probe, Squeal `src/` at `ed9c18b64`); matched in the real session log (read-only). |
| 2 | Catalog path or primer path? | Catalog path. Codex renders the catalog (`squeal:squeal` with `.../cache/hearsay/squeal/0.1.275/...`) into the thread's initial context. The primer the session got named the launcher `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal`, which worked. | Read in the session log; catalog rendering read in source code in `plugin-cache-cleanup.md` 2. |
| 3 | Regression of 005-73, or recurrence of #48? | Recurrence of the catalog half of #48. 005-73 fixed the primer CLI and the FAIL line (still fixed here). It did not change the catalog: `src/harness/codex/kept.ts` says "Codex's skill catalog keeps naming the cache directory a later install deletes", and the fix is one line in SessionStart and SubagentStart text only. | Read in source code; status.md 2026-10-21 (005-73). |
| 4 | Why did the reviewer have to search? | The session got no `Squeal's skill for this session, kept across plugin updates` line. Its first Squeal text was a registration from a hook after the first tool calls, and `skillLine` is added only on SessionStart and SubagentStart (`src/harness/codex/handlers.ts` 40 and 148; UserPromptSubmit 51 and PostToolUse 93 pass none). Why no SessionStart text arrived is not determined. | Read in the session log and source code; the cause of the missing SessionStart text is not determined. |
| 5 | Another way the saved skill goes | A second install while the session lives removes the oldest saved copy when no running process names it in its arguments (009-18 rule, `prune`). A Codex session process does not name the copy; only a daemon spawned from it does. | Verified by experiment (probe step 3); prune rule read in source code. |

## 1. The real session (read-only log)

Source: `~/.codex/sessions/2026/10/23/rollout-2026-10-23T14-36-20-01a168c3-20ff-7871-a06e-a123cd85b145.jsonl`, originator `cezar`, Codex `0.160.1`. Only path strings, event types and timestamps were extracted. No configuration values or credentials were read.

| Time (UTC) | Event |
|---|---|
| 12:36:21.183 | `session_meta` |
| 12:36:23.207 | Line 3: developer context with the catalog entry `squeal:squeal` under `cache/hearsay/squeal/0.1.275` |
| 12:36:25.251 | `~/.codex/plugins/cache/hearsay/squeal/0.1.276` created (directory mtime 14:36:25 +0200). Only `0.1.276` is in the cache now |
| 12:36:34.513 | `~/.codex/plugins/data/squeal-hearsay/versions/0.1.276` created |
| 12:36:34.538 | Line 19: first Squeal text, `SQUEAL · registered at revision 0`, naming the launcher. It holds no `kept across plugin updates` line (`grep -c` gives 0) |
| 12:37:07.908 | `cat .../cache/hearsay/squeal/0.1.275/skills/squeal/SKILL.md: No such file or directory` |

Inferred: the 0.1.276 install came 4 seconds after the session started, so it was Codex's startup auto-upgrade thread (`plugin-cache-cleanup.md` 1). The first hook ran on 0.1.276 and made the 0.1.276 copy, which agrees with "only the process that ran the upgrade refreshes its hooks". `versions/0.1.275` exists from 13:12:08 +0200, from an earlier session. The 0.1.275 copy is still on the host now.

## 2. The probe

Exact commands, from the repository root:

```
uptime; nproc
timeout 120 npx tsx docs/specifications/005-agent-adoption/research/probes/issue-81/probe.mts > docs/specifications/005-agent-adoption/research/probes/issue-81/run.txt 2>&1
```

`probe.mts` builds a fake Codex home in a fresh temporary directory, copies the committed `plugins/codex` as cache versions, calls Squeal's own `keepVersion`, `keptSkill` and `skillLine`, and runs `rm -rf` of the other versions as Codex's `remove_old_plugin_versions` does. No hook, daemon or installed plugin was touched. Output: `probes/issue-81/run.txt`.

- Step 1, 0.1.275: the copy is made, and `skillLine` gives the saved path.
- Step 2, install 0.1.276: `cat` of the catalog path gives `No such file or directory`; the saved 0.1.275 skill reads; the launcher exists and equals the plugin's.
- Step 3, install 0.1.277: the saved 0.1.275 skill is gone; 0.1.276 stays; the launcher stays.

**Host load.** Gate check before the session-log reading: `uptime` gave one-minute load 12.57, then 19.02 at 16:11:28, on 24 CPUs (`nproc`). The probe's own `uptime` printed **45.11** at 16:12:46, in the same command as the run. The run was not gated on that value, so it broke the brief's rule. The result is file existence, so load cannot change it. It was not re-run.

## Recommendation for Squeal

The coordinator decides. Evidence for the choice:

1. The launcher half of #48 holds. No change is needed there.
2. The catalog path is Codex's text. Squeal cannot keep `cache/.../<old>/` (Codex deletes it in its install call). What Squeal controls is where its own texts name the saved skill. Today only SessionStart and SubagentStart do. A session whose first Squeal text comes from another hook, as here, gets no saved path. A cheap fix: add the skill line to the first Squeal text a consumer gets, whatever the hook, or to the registration header. Inferred, not tested.
3. The skill text already tells the agent that the saved copy is at `<plugin data>/versions/<version>/skills/squeal/`, but an agent reads the skill only after the catalog path works, so that sentence cannot help here.
4. Step 3's prune can remove the saved copy of a live session after two installs. Whether that is worth guarding depends on how often two installs fall inside one session. Not measured.
5. Regression check for issue 81's second criterion: with `rm -rf` as the stand-in, a test where the first Squeal text of a Codex session comes from UserPromptSubmit or PostToolUse after the cache version was deleted, and the text names a readable saved skill.

## Open questions

- Why the session got no SessionStart text. Not determined, because the log does not show which hooks ran, and no Codex hook was run (brief: no installed plugin changes). Candidates: SessionStart ran on the 0.1.275 hooks while the cache was being replaced, or a cezar app-server thread does not fire SessionStart. Both are inferred.
- Whether Codex re-renders the catalog after compaction (still open from `plugin-cache-cleanup.md`).
- The second matching log of today, `rollout-2026-10-23T16-08-15-...`, names the 0.1.275 path only because it read this issue. It was not used as evidence.

## Sources

- Issue #81 and #48, `gh issue view <n> -R hearsay-tools/squeal --comments`, 2026-10-23.
- Squeal at `ed9c18b64`: `plugins/codex/skills/squeal/SKILL.md`, `plugins/codex/hooks/hooks.json`, `plugins/codex/bin/squeal-launcher`, `src/harness/shared/version-copies.ts` (`keepVersion`, `prune`), `src/harness/codex/kept.ts` (`skillLine`, `keepOnSpawn`), `src/harness/codex/handlers.ts` 40, 51, 93, 148, `src/harness/codex/command.ts`, `src/harness/codex/output.ts` (`capContext`).
- Spec 005 D3 (2026-10-21 and 2026-10-22 amendments), D6; `status.md` entries 005-73 and 005-81; spec 002 D1; `research/plugin-cache-cleanup.md`; `research/issue-48.md`.
- Host, read-only: the session log above; `ls` and `stat` of `~/.codex/plugins/cache/hearsay/squeal/` and `~/.codex/plugins/data/squeal-hearsay/{versions,bin/squeal}`.
- Probe: `probes/issue-81/README.md`, `probe.mts`, `run.txt`.
