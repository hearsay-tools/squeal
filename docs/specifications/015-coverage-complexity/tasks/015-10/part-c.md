# 015-10 Part C: live sessions, notes

Worker 4ddd4e37, 2026-10-24, 06:37Z to about 07:30Z. The results are in `../../lessons.md`, "Round 1, live sessions (015-10)". These notes are the residue: how the sessions ran, where the raw data was, and what to know before running such a round again.

## Isolation and setup

| Item | Value |
| --- | --- |
| OS user | `squeal-e2e` (uid 1002). Every clone, install, daemon and model session ran as that user through `bin/as-e2e.mjs` (007-18's helper, plus `COREPACK_HOME` and the pnpm store under the case root): `sudo -n [--preserve-env=ANTHROPIC_BASE_URL,ANTHROPIC_AUTH_TOKEN] -u squeal-e2e -H env HOME=… PATH=… sh -c 'cd "$1"; exec "$@"'`, cwd `/`. Credentials by name only. |
| Case root | `/home/squeal-e2e/runs/d1510`, with its own `home`, `tmp`, `claude` (`CLAUDE_CONFIG_DIR`), `codex`, `xdg`, `corepack`, `bin`. |
| Squeal | 0.1.284: `git archive squeal--v0.1.284 plugins/claude-code .claude-plugin`, the marketplace renamed `hearsay`, installed at user scope in the case's `CLAUDE_CONFIG_DIR`. `bin/squeal` is the plugin's `squeal-launcher`; `squeal --version` printed 0.1.284. |
| Harness | Claude Code 2.1.300, `claude -p --model sonnet` (the init event names `claude-sonnet-5-5`), `--output-format stream-json --verbose --include-hook-events --permission-mode bypassPermissions`. The init event also lists three plugins the user had not installed: `cc-plugin-agents-md`, `cc-plugin-telemetry`, `cc-plugin-plugin-authoring`. |
| Node | `/opt/squeal-e2e/node24` (24.21.0) for everything; cezar needs 24.15 or later. |
| squeal clone | Bundle of `origin/main` at `d5018817a` (`git bundle verify` passed), local branch `dogfood`. `npm ci`: 196 packages, 16 s. Complexity on, `docs/**` excluded (the repository's own config). |
| cezar clone | Bundle of `main` at `03c905a00` (complexity on, the local commit of `window.md`; `git bundle verify` passed), local branch `dogfood`. `corepack pnpm install --frozen-lockfile` (pnpm 12.11.2). Default include and exclude. |
| First count | Started by `squeal start` in each clone at 06:41:48Z. Both done within 45 s wall: squeal 1,204 files, 81 functions over 20, 4 parse errors; cezar 944 files, 267 over 20, 1 function in a parse error, 1 file too big. The daemons used 40 s and 47 s of CPU in those 45 s, most of it listing 1,002 and 989 test files: the code pass logs no timing of its own. |

## Scripts (copied to `part-c/bin/`, the prompts to `part-c/prompts/`; they ran from `/tmp/dogfood-015-10/w-4ddd4e37/`)

| Script | What it does |
| --- | --- |
| `as-e2e.mjs` | Runs one command as `squeal-e2e` in the case root. |
| `setup.sh` | Steps `dirs`, `pin`, `bundles`, `clone`, `deps`, `install`. |
| `session.mjs <id> <repo>` | One session: resets the clone to its base, runs `squeal start` and `squeal status --wait 30000` so the reset is counted before the session registers, records `squeal code`, the daemon's CPU and the load, runs `claude -p` with `prompts/<id>.txt`, stamps every stream line with epoch ms, then records the diff, `squeal code`, `squeal code <changed files> --json`, the status and the transcript. A lock directory per clone refuses a second runner. |
| `timeline.py`, `summary.py`, `tally.py` | A session's tool calls, hook texts and agent text by time; each complexity line with the edit before it and the agent's next action; every complexity line by kind. |
| `bench-count.mts` | The released counter (`git archive squeal--v0.1.284 src`, run through `tsx`) on a list of files: per file the median of 5 timed counts after one warm-up count, then median, p95 and total CPU. |
| `pull-truth.mts` | Counts both sides of sq6's fast-forward and lists each function over 20 whose body moved. |
| `parse-errors.mts`, `included.mjs` | The error ranges of a file that does not parse; the counted paths of a code store, opened read only. |

Each session's outputs stay in `/tmp/dogfood-015-10/w-4ddd4e37/logs/sessions/<id>/` while the host keeps `/tmp` (`stream.jsonl`, `transcript.jsonl`, `meta.json`, `diff.patch`, `code-before.txt`, `code-after.txt`, `code-after-paths.json`).

## Sessions and their order

Planned: four per repository, kinds 1 to 4 of the brief. Added: `sq5` and `cz5`, refactors the prompt makes stepwise, because `sq2` and `cz2` each refactored in one edit and so gave open question 4 nothing; `sq6`, a session that starts on a branch behind the base and fast-forwards first, to reproduce `window.md`'s pulled `STILL FAIL`; `cz6`, a second try at kind 3 in cezar, because `cz3` stayed under 20.

The squeal sessions ran one after another; the cezar sessions too, beside them. Until 07:05Z each session started only at a one-minute load of 24 or below (each check logged in `meta.json` `gate`). At 07:05Z the human dropped that rule ("complexity is cheap"); later sessions started at once, and each start still records the load.

## What went wrong, and how it was handled

- **A reset with no daemon.** A daemon exits 3 s after its last session ends ("no session registered for 3 s after its last one ended"). The reset before `sq2` therefore ran with no daemon; `sq2`'s SessionStart started one, registered the session at the stale revision 4 ("80 functions over 20"; there were 81), and delivered the reset as `FAIL complexity: stopCommand`. That is a finding (P2), kept as evidence. From `sq3` on, the runner starts a daemon after each reset.
- **Two sessions in one clone (my error).** I started `cz5` while `cz4` still ran in the cezar clone. `cz5`'s reset at 07:05:07Z removed `cz4`'s edits. I stopped both sessions (my own processes, SIGTERM), set their outputs aside as `cz4-contaminated` and `cz5-aborted`, added the per-clone lock, and ran them again as `cz4r` and `cz5r`. Only `cz4-contaminated`'s first 37 s are used, and only to show that its too-big line matched `cz4r`'s.
- **Stale `squeal code` after an edit.** In `sq2` the reason was the daemon catching up after its start; in `cz2` the agent ran `squeal code` in the same Bash call as its edit. Both agents noticed. P4.

## For the next worker

- Start a daemon (`squeal start`) after any reset or checkout between sessions, and wait for `squeal status --wait`, or the next session's registration is stale.
- One session per clone at a time; reuse `session.mjs`'s lock.
- Sonnet edits mostly through Bash (`python3 - <<'E' … open(p,'w')`, `sed -i`), not the Edit tool, unless the prompt names the Edit tool. PreToolUse hooks for Bash carry no SQUEAL text, so the delivery point after a Bash edit is the next PostToolBatch.
- At the end of the round: `squeal stop` in each clone, then the clones were removed (see `lessons.md`, Setup).
