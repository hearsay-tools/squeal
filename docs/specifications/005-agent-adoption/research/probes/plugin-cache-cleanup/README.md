# Probe: plugin cache cleanup (005-72)

Throwaway. `upgrade.sh` installs a dummy plugin (a manifest and one `SKILL.md`, no hooks or code) from a local git marketplace, then upgrades it once in Codex and once in Claude Code, and lists the cache after each step. It runs only as the throwaway user `squeal-e2e`, fed on stdin with cwd `/`; never as the agent user. `run.txt` is its output.

Result (2026-10-21, `run.txt`): the Codex half ran; the Claude Code half stopped at `claude plugin marketplace add`, because Claude Code clones shallow and Python's dumb HTTP server cannot serve a shallow clone. It was not retried: the run started at load 25.78, above the brief's limit of 24. The Claude Code answer rests on its docs, its bundled source and this host's own cache instead.
