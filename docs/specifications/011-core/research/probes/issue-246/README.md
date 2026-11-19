# Throwaway #246 probe

One isolated Vitest file, stopped-daemon edits, lookup-only restarts, focused waits, plain named demand and explicit retry. See [findings](../../issue-246.md) for commands and limits.

`probe.py <pinned squeal.mjs> <node_modules>` writes `results.json`, stops its own daemon and removes its fixture. It refuses an existing fixture and skips when one-minute load exceeds CPU count. The original run's retained output is in `results.json`; fixture runtime files are not retained. No product suite is run.
