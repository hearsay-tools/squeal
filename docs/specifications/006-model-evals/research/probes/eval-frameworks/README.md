# Probes: eval-frameworks (006-15)

Throwaway, kept as the record of `../../eval-frameworks.md`. **Do not run `inspect_cell.py`**: its one run overwrote the host's real `~/.claude/settings.json` (the incident in the findings). Nothing else here starts a harness.

- `extract-fakes.mjs <dir>`: copies the fake `claude` and `codex` scripts out of `test/evals/fake-cell.ts` unchanged into `<dir>/bin`, behind a `claude` wrapper that logs its argv and isolation variables and tees stdout (stream-json) to `$FAKE_LOG/events.jsonl`. Starts nothing.
- `inspect_cell.py`: one cell as an Inspect task: a setup solver for the fixture and a knob, `inspect_swe.claude_code(version="sandbox")` with a scratch `HOME` and the fake first on `PATH`, and a scorer calling `evals/lib`'s `parseClaim` and `claudeTimeline` through `node`.

Run, 2026-10-11, in `/tmp/sq-evalfw` (removed afterwards; no venv or log is committed):

```sh
uv venv -p 3.12 venv && uv pip install -p venv/bin/python inspect-ai==0.3.278 inspect-swe==0.2.71   # 9 s, 234 MB, 82 packages
node extract-fakes.mjs /tmp/sq-evalfw/probe
env -u CLAUDECODE -u <CLAUDE*/CEZ_* vars> PROBE=/tmp/sq-evalfw/probe INSPECT_LOG_DIR=/tmp/sq-evalfw/probe/logs \
  venv/bin/inspect eval inspect_cell.py --model mockllm/model --sandbox local --display plain
```

Result: the setup solver ran (git init and commit in the scratch work tree). `inspect_swe` then wrote `$HOME/.claude/settings.json` in the real home and resolved the host's real `claude` instead of the fake: the wrapper's log stayed empty. The real binary ran with the scratch `HOME` and Inspect's localhost bridge as `ANTHROPIC_BASE_URL`. The bridge failed (`agent bridge requires optional dependencies: pip install anthropic`), so no provider call was made, and the sample ended with `[claude-code:unrecognized_model]` before the scorer ran. The coordinator restored the settings file and removed Inspect's leftovers outside `/tmp/sq-evalfw`. After that, research was read-only.
