# runner-trigger probes (throwaway)

Throwaway scripts for row 019-01. They build a fixture repository under
`$TMPDIR`, never in a worktree, and run the committed plugin build of the
worktree they are called with. Run with `HOME` and `XDG_RUNTIME_DIR` pointed
at directories under `$TMPDIR`, so the fixture's daemon takes no slow-slot
permit from the host's real worktrees. Stop the daemon (`squeal stop`) and
delete the fixture after use. `run.log` is the transcript the findings cite.

`aggregate.mjs` and `sample.mjs` open a Squeal store with `readOnly: true`
and only read it; `cezar-aggregate.txt` and `squeal-aggregate.txt` are their
output on 2026-11-02 for cezarion's and this repository's stores.
