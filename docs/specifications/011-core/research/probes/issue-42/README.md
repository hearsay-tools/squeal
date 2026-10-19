# Issue 42 probe (throwaway)

Throwaway evidence for `../../issue-42.md`. Not product code; delete freely.

`probe.sh <worktree> <cli.mjs> <test-file> <test-file>` runs the given Squeal CLI's
`status` with paths, without and with `--wait 1`, plain and `--json`, in `<worktree>`,
and prints exit codes, line counts, stderr and stdout. The snapshot form only reads
the store; the named wait connects to a live daemon if one exists (and may send one
`promote` request, 011 C15) and spawns none.

`output.txt` is the run of 2026-10-19 against `/home/agent/projects/squeal`
(revision 837, no daemon, no dependencies) with the 0.1.222 plugin bundle.
