# Throwaway issue 179 probe

This is research evidence, not a product test or performance benchmark.

Run from the repository root with installed dependencies:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-179/probe.ts > docs/specifications/011-core/research/probes/issue-179/output.jsonl 2> docs/specifications/011-core/research/probes/issue-179/stderr.txt
```

The script checks one-minute load against the available CPU count before each
scenario. It skips the scenario when load is higher. `fixture.ts` adapts
`test/scheduler/claims-fixture.ts` at commit `1ac649d` to standalone cleanup and
puts repositories under this directory's ignored `.scratch/`. It imports the
real scheduler, store and state sink. It uses a fake runner, fake daemon presence
and no shared capacity pool, sockets or daemon processes. It never registers
with or controls a production daemon. `node_modules` stays out of git.

Case 1 has 849 files, an owner holding its first 200-file tier, and a requester
promoting one claimed and one unclaimed file. Assertions check equal keys,
claimed-file waiting, unclaimed-file execution, the named status claim reason,
and a current pass after the owner closes without a result. A direct clock
probe checks the claim boundary at 7,000 and 7,001 ms.

Case 2 has one file and a 1,000 ms requester timeout. The owner stays active;
the requester takes over after the timeout plus 6-second grace. Polls have a
20-second safety bound. Cleanup releases held fake runs, closes schedulers and
stores, and deletes the temporary repositories, including their nested Git
worktrees. No external worktree or hold is changed.

Final run: exit 0, stderr empty, 10.323 seconds total. See `output.jsonl` and
`../../issue-179.md` for the result and limits. No Vitest suite was invoked by
this command.

Repository validation: `squeal status --wait 60000` with the report, `probe.ts`
and `fixture.ts` paths exited 3: no test file's closure holds these paths.
At revision 11 it reported zero known failures and 683 unknown test files.
The direct probe above is the executed check. Targeted `biome check
--no-errors-on-unmatched` checked zero files (the docs directory is excluded),
so it supplies no lint evidence. No product typecheck, build or full suite ran.
