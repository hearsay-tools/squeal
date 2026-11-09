# Research brief 015-125: can Squeal plan a mutation-test run?

Use /researcher. Shape: research. Outcome: evidence for or against a read-only Squeal command that tells a mutation tool (StrykerJS) which code to mutate and which test files to run for it. The command would read Squeal's stores and run nothing, like `squeal reach` (D11). It would not be part of the agent loop. Follow the rules in `README.md`, with the exceptions below.

Read first: `docs/vision.md` (decision filter, "existing tools first"); this spec's D8, D9 and D11; `research/selection-tools.md` (the StrykerJS part); `research/edit-reach.md` (how it read cezar's store copies); in `~/projects/cezar`: `stryker.config.json`, `.github/scripts/mutants-*.{cjs,mjs}`, `.github/mutants/targets.json`, `.github/workflows/mutation-report.yml` and `mutants-weekly.yml`.

The test bed is cezar (`hearsay-tools/cezarion`). Its pull-request mutation job picks tests with Vitest's `related` mode (import graph) and skips a package above 150 related test files.

Questions:

1. **Test-set size.** For at least 10 recent cezar pull requests that the mutation job ran on, take the changed product functions. Count test files three ways: Vitest `related` (what the job does now); Squeal's coverage records, "a function of the file ran" and "the file loaded only" kept apart; and Stryker's own per-test coverage from its dry run. How often would the 150-file cap stop skipping a package?
2. **Safety.** On a bounded sample (at most 3 files and 400 mutants), run Stryker with the `related` set and with Squeal's "called" set. Count mutants killed by the first set and survived with the second (false survivors). Name the tests that killed them and why Squeal's records missed them.
3. **Uncovered mutants.** From cezar's stored mutation reports (workflow artifacts or PR comments), what share of mutants are `NoCoverage`? Does Squeal's "no test runs it" state predict them at the same revision?
4. **Cost.** Split a Stryker run into the dry run and the mutant runs. What does a smaller test set save in each, in CPU and wall time? Read in source whether Stryker 9/10 with the Vitest runner accepts an explicit test-file list per run, and whether it can use outside coverage instead of its dry run.
5. **In-place mutants and a live daemon.** cezar runs Stryker with `inPlace: true`. In a scratch repository with your own isolated Squeal daemon, run Stryker in place and then in sandbox mode on one small file. Record what Squeal does: runs started, transitions pushed, store writes, CPU. Say whether Squeal watches `.stryker-tmp`.

Exceptions to the README: Stryker may be installed in a scratch copy of cezar under `/tmp`. You may run Stryker there with nice 10 and concurrency at most 4. Record the one-minute load beside every timing. Read cezar's store only from a copy taken with its `-wal` and `-shm`. Budget: about three hours and at most 90 CPU-minutes of Stryker. Then write what you have. Delete the scratch copies at the end and show that nothing of them is left.

Own `mutation-planning.md` and `probes/mutation-planning/`. Edit no board, spec, status, test or product file, in squeal or in cezar.

Done when every numbered question has a tagged answer and the recommendation states the false-survivor count, the test-set reduction and the limits.
