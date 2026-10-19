# 011-24 scratch: before-samples

Throwaway. `before.mjs` calls today's formatters (`formatStatus`, `namedText`, `waitText`, `formatRegistration`, Stop's `statusText`, `waitsText`) on snapshots seeded from each finding's scenario and prints `before.md`. No store, no daemon, no Vitest; one Node process.

From the worktree root (Node 24; `source-loader.mjs` is `research/probes/issue-41/`'s, mapping `.js` specifiers to the `.ts` sources):

```sh
TZ=UTC node --experimental-transform-types --disable-warning=ExperimentalWarning \
  --import ./docs/specifications/011-core/tasks/011-24/scratch/source-loader.mjs \
  docs/specifications/011-core/tasks/011-24/scratch/before.mjs \
  > docs/specifications/011-core/tasks/011-24/scratch/before.md
```

Rendered 2026-10-20 at `26975590` (0.1.224's formatters), load 47 on 24 CPUs, exit 0. The seeded numbers follow the findings; where a finding gave none (the 27-file tier of gh-40 run A, gh-41's 91 current files) they are chosen to be consistent. The after-samples in `../design.md` are derived by hand from these renders and the same seeds, since the formatters they describe do not exist yet.
