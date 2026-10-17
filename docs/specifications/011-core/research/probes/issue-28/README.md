# Probes for issue 28 (throwaway)

Throwaway research probes for `../../issue-28.md`. Not product code, not tests; delete freely.

- `ts-hooks.mjs`: a Node module hook that maps the source's `.js` specifiers to `.ts`, so Node 24's
  type stripping runs `src/core/state/fingerprint.ts` unbuilt.
- `fingerprint-probe.mjs`: feeds the issue's two message pairs and four controls through the real
  `describeFailure` and prints whether each pair shares a fingerprint.

Run from the repository root (no `npm ci`, no daemon, no store):

    node --import ./docs/specifications/011-core/research/probes/issue-28/ts-hooks.mjs \
         docs/specifications/011-core/research/probes/issue-28/fingerprint-probe.mjs
    TMPDIR=/tmp/squeal-1001/tmp/6db45f9b91a3d272 node --import ... (same probe)
