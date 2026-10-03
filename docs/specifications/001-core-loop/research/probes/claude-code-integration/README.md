# Throwaway probes: claude-code-integration

**Throwaway.** Nothing here is product code. These scripts exist only to produce the evidence cited in `../../claude-code-integration.md`. Delete them freely.

Claude Code versions: 2.1.286 and 2.1.288 (the CLI auto-updated mid-session; each log records its version).

## Layout

- `run.sh <scenario> <prompt> [args]`: runs `claude -p` inside `scenarios/<scenario>/` with `--setting-sources project`, a scrubbed environment, `--output-format stream-json --include-hook-events`.
- `irun.sh <scenario> [prompt]`: same, but starts an interactive session in tmux (used for `asyncRewake`, which behaves differently in `-p`).
- `view.sh`: compacts a stream-json transcript.
- `scenarios/<name>/.claude/settings.json`: the exact hook config for each experiment. Each scenario is its own scratch project; this repo's `.claude` is never touched.
- `hooks/*.sh`: hook scripts. `log.sh` records each hook's stdin with a ms timestamp. Others deny, inject a random nonce, sleep then exit 2, hang, etc.
- `plugin-probe/`: a minimal plugin loaded with `--plugin-dir`.
- `logs/`: sanitized output. `*.view.jsonl` (compact transcript), `*.timeline.txt` (debug-log lines for tool start/end, hook results, API requests), `*.nonces.log` (when a hook issued or delivered a nonce), `*.hooks.trim.jsonl` (hook input fields), `*.transcript-excerpt.jsonl` (interactive sessions). Raw debug and stream logs are gitignored because they carry account details.

## Scenarios

| Scenario | Question | Mode |
|---|---|---|
| `pretooluse` | Q2 deny via JSON and via exit 2 | `-p` |
| `posttool` | Q3 PostToolUse/PostToolBatch additionalContext, timing | `-p` |
| `rewake-midturn`, `rewake-p288` | Q4 asyncRewake in `-p` | `-p` |
| `async-p` | Q4 control: plain `async: true` in `-p` | `-p` |
| `rewake-idle` | Q4a idle wake, re-arm from Stop | interactive |
| `rewake-turn` | Q4b mid-turn, Q4c during long Bash | interactive |
| `rewake-timeout` | Q4/Q6 asyncRewake past its timeout | interactive |
| `subagent` | Q5 ids and per-agent context | `-p` |
| `failures` | Q6 hang, missing script, exit 1, leaked child stdout | `-p` |
| `plugin` | Q1 plugin hooks via `--plugin-dir` | `-p` |
