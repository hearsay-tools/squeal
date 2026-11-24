# Issue 278 throwaway probe

Run from the repository root: `pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-278/probe.mjs`.

This probes existing source functions with synthetic inputs. It creates no
daemon, store, remote machine or provider connection. It checks remote planning
policy and the named timeout clause when heartbeat liveness is the selected
reason. It does not reproduce the historical outage or a complete CLI call.
Keep `node_modules` out of git. Findings: ../../issue-278.md.
