# Issue 5 probe (throwaway)

Throwaway: evidence for `../../issue-5.md`, not a test and not product code.

`probe.ts` loads `squeal.config.json` from a temp directory with
`slow.include` set and `stop.requireSlowSuite` false, then true, and prints
the primer (Claude Code and Codex naming) and the header's `Slow tier:` line
for that policy. It reads no store, starts no daemon and queues no test file.

Run from the repository root after `npm ci`:

    npx tsx docs/specifications/004-slow-suites/research/probes/issue-5/probe.ts

`output.txt` is the run recorded in the findings, with its revision.
