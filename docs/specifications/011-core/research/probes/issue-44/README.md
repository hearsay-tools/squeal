# issue-44 probe (throwaway)

Throwaway probe for `../../issue-44.md`. Not product code; delete freely.

`probe.sh <cli.mjs> [files]` builds a synthetic git repo in a fresh `mktemp -d` with one node:test project of 25 passing files and `baseline.onStart: "lookup-only"`, under a private `HOME`, `XDG_*` and `XDG_RUNTIME_DIR`, starts its daemon, edits one file, runs `status --wait 60000 <file>` (text and `--json`), stops the daemon and deletes the directory. Needs no install. `output.txt` is the run recorded for the findings.
