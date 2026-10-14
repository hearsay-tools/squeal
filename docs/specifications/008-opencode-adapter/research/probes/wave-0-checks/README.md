# Probes: 008 wave-0 checks (throwaway)

Throwaway evidence for `../../wave-0-checks.md` (board row 008-11). Nothing here is imported or built. Run on 2026-10-14 against OpenCode 1.18.35 in `/home/squeal-e2e/.npm-global`, Node 24.21.0.

- `isolation-check.txt`: the output of `test/fixtures/opencode/isolation-check.sh` (checks 1 and 2). That script lives with the fixture, not here, because an OpenCode upgrade re-runs it.
- `checks.sh`, `q2-plugin.js`: checks 3 and 4 (open questions 1 and 2); `checks.txt` is their output. `checks.sh` tars itself, the probe plugin and `test/fixtures/opencode/scripted-provider.ts` into `/home/squeal-e2e/opencode-wave0` and runs there as `squeal-e2e`, from cwd `/`, with `env -i`. Each check gets the isolation `test/helpers/opencode.ts` uses (HOME, TMPDIR and the four XDG directories in a fresh `/tmp/oc-wave0.*`, the global config directory seeded, models fetch and autoupdate off) and the scripted provider, so no credentials and no network. The provider config is the project's `opencode.json`, so the global config holds only what `opencode plugin -g` wrote.

Isolation: no OpenCode run as the agent user; no key passed (the scripted provider needs none); nothing written under `/home/agent`. `KEEP=1` keeps the temp directory; otherwise each script removes it. `/home/squeal-e2e/opencode-isolation` and `/home/squeal-e2e/opencode-wave0` hold the copied scripts; remove them with `sudo -n -u squeal-e2e rm -rf /home/squeal-e2e/opencode-isolation /home/squeal-e2e/opencode-wave0`.

The isolation check's bare runs (HOME and PATH only) wrote `squeal-e2e`'s own `~/.local/share/opencode` (database, log, a snapshot repository), `~/.local/state/opencode/locks` and refreshed `~/.cache/opencode/models.json`; that is the throwaway user's state and was the point of the comparison.
