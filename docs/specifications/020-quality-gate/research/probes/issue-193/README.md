# Issue 193 throwaway probe

A research fixture for hearsay-tools/squeal#193, not a product test. `probe.sh`
builds a temporary git repo with two node:test projects (a preload that imports
`node:module` through a helper; a test with a fully computed `import()`), runs the
one-shot gate `squeal code --base main --json` in five cases, and deletes the repo.
It starts no daemon and installs nothing. HOME and the XDG directories point into
the temporary directory; the store is the temporary repo's own. It skips when
one-minute load exceeds `nproc`.

    VITEST_MODULES=$PWD/node_modules sh \
      docs/specifications/020-quality-gate/research/probes/issue-193/probe.sh \
      /home/agent/.claude/plugins/cache/hearsay/squeal/0.1.443/dist/cli/squeal.mjs \
      docs/specifications/020-quality-gate/research/probes/issue-193/results

Cases: `unrelated` (CI-only change), `selected` (the statically imported module),
`selected-again` (rerun), `dynamic-only` (only the computed-import target), and,
with `VITEST_MODULES` set to a `node_modules` holding Vitest,
`worktree-vitest-unrelated` (linked worktree, Vitest configured, CI-only change).
`results/` keeps each case's stdout JSON and stderr from the recorded run
(2026-11-12, 0.1.443, load 2.4 to 4.9 of 24).
