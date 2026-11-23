# Issue 267 selection probe

Throwaway, source-level probe. From the repository root:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-267/select.mjs
```

Imports the actual narrow-run and named-status selectors. Gives both the same
synthetic listing of two test files under this real directory, with an inert
runner returning no affected files and an empty reverse dependency index.
The listed files need not exist: neither selection function reads their content.
No daemon, database, test runner, real project policy or installed runtime is
started or modified. No installation is needed beyond the checkout's dependencies.

Observed on checkout 0.1.604 (`f04de26bf0c82439130a7cfd10cb2f1895bd6d01`),
2026-11-23, Node v26.13.0, exit 0, command wall time 0.43 s:

- `narrowFolder`: no selected group; directory in `unmatched`.
- `statusFolder`: `kind: "directory"`, `selects: 2`.
- `narrowFiles`: group `run-loop`, count 2, no unmatched paths.
- Runner `affected` called once, with the normalized directory path.

Assertions encode those observed defective results, not the desired behavior.
This is not an end-to-end CLI reproduction or a test-suite pass.
