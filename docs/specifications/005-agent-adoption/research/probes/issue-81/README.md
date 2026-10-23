# Probe issue-81 (throwaway)

Throwaway probe for `../../issue-81.md`. Not product code. Run from the repository root:

    uptime; nproc
    npx tsx docs/specifications/005-agent-adoption/research/probes/issue-81/probe.mts > docs/specifications/005-agent-adoption/research/probes/issue-81/run.txt 2>&1

It builds a fake Codex home in a fresh `mktemp -d` directory, with `plugins/codex` copied as cache versions 0.1.275, 0.1.276 and 0.1.277. It calls Squeal's own `keepVersion` and `skillLine` from `src/`, and `rm -rf` stands in for Codex's `remove_old_plugin_versions`. It never touches `~/.codex`, starts no daemon and runs no hook.
