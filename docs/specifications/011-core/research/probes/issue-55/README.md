# issue-55 probe (throwaway)

Throwaway reproduction for GitHub issue 55; not product code, not a test.
`seed.mjs` builds a disposable git repo under `/tmp` with a seeded Squeal store
(schema V1 copied from `src/core/store/schema.ts`), so `squeal why` can be timed
without touching any real store or running any suite. `run.sh` seeds a few
sizes, times `squeal why` against each, and deletes the repos. Findings:
`../../issue-55.md`.
