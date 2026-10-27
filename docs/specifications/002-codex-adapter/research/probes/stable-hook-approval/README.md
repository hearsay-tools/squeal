# Stable hook approval probe (throwaway)

Run from any directory on Linux with Node and Codex installed:

```sh
node docs/specifications/002-codex-adapter/research/probes/stable-hook-approval/run.mjs > /tmp/approval-results.json
```

`PROBE_CODEX` can name another Codex executable. The default is this host's native
Codex launcher, avoiding its login-status compatibility wrapper. The assertions
pin Codex 0.164.0 behavior; another version can fail them by design.

The probe creates a unique scratch directory whose name contains spaces. Every
Codex process gets new `HOME`, `CODEX_HOME` and `XDG_CONFIG_HOME` directories and
an allowlisted environment. It reads no real Codex config or credential file.
It makes no model request. Scratch files are removed after success and retained
on failure for diagnosis. Commands have bounded timeouts.

Each of two isolated installations uses all 10 commands in the repository's
`plugins/codex/hooks/hooks.json`. The first keeps `${PLUGIN_ROOT}`; the second
changes only those references to `$PLUGIN_ROOT`. Harmless fixture bundles print
their file URL, installed manifest version and environment root. The per-tool
shell fast paths remain intact; a scratch `squeal.config.json` enables them.

For each form:

1. Install 1.0.0 with `codex plugin marketplace add` and `codex plugin add`.
2. List all hooks through `hooks/list`, approve with `config/batchWrite`, and
   confirm all 10 are trusted. Preserve the two saved trust fields.
3. Change only the manifest version to 1.0.1 and run `codex plugin add` again.
4. Assert stable keys and declaration hashes, changed content hashes and 10
   modified hooks. Check the old cache directory was removed.
5. Execute all 10 commands returned by `hooks/list` through `bash -c`, with the
   plugin environment Codex sets. Assert they reach version 1.0.1 in a path with
   spaces. This proves shell execution, **not** that Codex runs modified hooks.
6. Compare each raw declaration hash and each listed-command hash with Codex.
7. Approve 1.0.1, edit only PostToolUse's command, and assert that only its
   declaration hash changes but all 10 hooks become modified.

`results.json` is the full, path-redacted result from 2026-10-27, Codex 0.164.0.
It contains commands, keys, hashes, saved trust fields and shell output, not
credentials. Each app-server starts fresh so the probe does not rely on stale
process caches. No bypass flag is used. Approval writes establish experimental
baselines; they are not a proposed way to preserve approval.

This does not exercise model-driven events, running-session cache deletion,
Windows shells, or every intermediate Codex version. See the findings for the
source evidence and those limits.
