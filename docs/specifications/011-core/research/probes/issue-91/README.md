# Issue 91 probe (throwaway)

Throwaway. Not part of the suite: the root `vitest.config.ts` includes only `test/**` and `src/**`.

A synthetic copy of the incident's shape on the in-memory fixture of
`test/scheduler/tier-yields-text.test.ts`: four slow files held in one Vitest
tier, two files promoted behind it, as `squeal status --wait` with named
files promotes them. It prints what a named wait reads (`standingsOf`, the
text line `classLines`, the `--json` entry `fileEntry`) at three moments:
before the cut, after the restart, and with the store's run rows.

Run from the repository root:

    npx vitest run --config docs/specifications/011-core/research/probes/issue-91/vitest.config.ts

Output of the recorded run: `output.txt`.
