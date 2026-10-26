# Probe 017-02: lint seams (throwaway)

Throwaway. Not product code and not a test. It is kept as evidence for `../../lint-seams.md`.

`surfaces.ts` imports Squeal's own modules at `7e3e54bb8` and asks them four things:

- **P1.** A per-file ESLint result sent down the test path: a `file` check `[eslint] src/a.ts` with two findings, through the real state sink, delivery, `formatDelta`, `knownFailuresLine` and the evals parser `squealEvidence`. Three edits: s1, two findings appear; s2, a line is inserted above both; s3, the second finding is fixed.
- **P1b.** Whether the code pass still counts a file once a runner lists it (`mainStoreSource().testFiles()`, `includedSet`).
- **P2, P3.** What the main store and the code store do when a row holds a check kind (`lint`) or a measure (`lint`) that their codecs do not know. This is what an older Squeal reads after a newer one writes such a row.
- **P4.** Whether the evals parser reads a line in the code-line form (`FAIL lint: ...`, one space after `FAIL`).

Run (no daemon, no socket, no live store; every file goes under a scratch `TMPDIR`):

```sh
T=$(mktemp -d /tmp/lint-seams-run-XXXX)
HOME=$T XDG_RUNTIME_DIR=$T XDG_CONFIG_HOME=$T TMPDIR=$T npx tsx surfaces.ts > out.txt
rm -rf "$T"
```

`out.txt` is the output of the run used in the findings, on 2026-10-26, Node v24.21.0. The header says `revision 0` because the probe records no revisions. It does not change the check lines.
