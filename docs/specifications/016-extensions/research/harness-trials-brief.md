# Research brief 016-35: Cursor CLI and OMP, tried for real

Use /researcher. Shape: research. Outcome: which of Squeal's behaviours work today in Cursor CLI and in OMP, shown by real sessions, and the smallest adapter for each. Follow the rules in `README.md`, except the rule against agent sessions and installs: the human (2026-10-26) authorized trial runs of Cursor CLI and OMP only, on the conditions below.

Read first: `harness-landscape.md` (Cursor under class A, recommendation, open questions); `seams.md` on the harness side; 011 C8 (delivery rules); 012's spec for the Claude Code hooks; 009's spec and `plugins/pi/` for the Pi package; `docs/vision.md`.

Questions:

1. **Set-up.** Install each tool for the user `squeal-e2e`, at the version this host's `agent` user has (Cursor CLI `2026.10.22-27dcf5f`, OMP `18.8.0`), from its official source. Say what each needs to log in.
2. **Cursor CLI.** Which hook sources load (`.claude/settings.json`, `.cursor/hooks.json`, a Claude Code plugin); which events fire and with what payload; whether hook output reaches the model (exit 2 with stderr, JSON fields); whether a stop hook can continue the turn; whether the hook runs as a child of the CLI process.
3. **OMP.** What OMP is and how it relates to Pi; its extension API; whether Squeal's Pi package loads unchanged; which events fire; whether an extension can push a message into an idle session.
4. **Behaviours.** For each tool, a table of Squeal's five behaviours: the start message; a `PASS -> FAIL` reported at the next tool boundary; the next write blocked once after an unseen failure; the check at the end of a turn; an idle agent woken by a failure. The verdict per cell is works, partial or missing, each with its session log lines.
5. **Recommendation.** The smallest adapter for each tool, and what the shared harness contract and its test kit must state. Name the docs you re-read, with dates.

Conditions:
- Every session and install runs as `squeal-e2e` through `sudo -n -u squeal-e2e -H env -i ...`, with cwd `/`, in a scratch repository under that user's home. Send Squeal in through `git archive` of the latest release tag, and name the tag.
- Never read, copy or print the `agent` user's credentials or config. Pass a credential only by its environment variable name (`--preserve-env=NAME`). If a tool needs a login or a key that is not available that way, stop and send me a request that says what the human must do.
- Models: OMP uses only OpenAI (`gpt-6-luna`, `gpt-6-astra`) or `grok-4.7` models, never a Claude model. Cursor uses its default or a GPT model. At most 10 short sessions per tool.

Own `harness-trials.md` and `probes/harness-trials/`.
