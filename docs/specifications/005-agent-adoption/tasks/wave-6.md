# Wave 6: the warm-up texts, and dogfooding

On 2026-10-14 the human gave the go to run 005-39 with 005-41, and 005-18 beside them, while the release waits for 001's lock review. The two workers touch disjoint files. Every full Vitest run uses `--maxWorkers=4`. Do not run `npm run build` in a worker tree.

## 005-39 and 005-41: the warm-up names its wait; inputs are build output

Use /worker.

**Outcome.** Two changes to the warm-up:
- It says why it is waiting when the slow tier holds files for host load, instead of going silent (defect 2 in `research/e2e-setup.md`).
- Its ignored-read suggestion, and the setup skill, say that an input is build output, never state that the suite's own bootstrap rewrites (descriptors, logs, PID files).

The second change comes from cezar: 70 of 74 browser specs read `.ai/qa/test-env.json`, which is rewritten on every environment boot. Declaring it as an input would re-key every browser file on each boot.

**Read.**
- Spec 005 D3: the warm-up, and "Slow tests and their inputs".
- The board rows 005-39 and 005-41.

**Shape.** A repair.

**Seam.**
- `src/cli/warmup.ts` `reportProgress` (line 231). When the open checkpoint's slow files are deferred for load, print one line in the status line's words (`src/core/state/slow-text.ts`): for example `squeal warmup: 1 of 3 test files done; 2 slow test files waiting for host load to drop`. Print it again only when it changes.
- `ignoredReadText` (line 140): one clause on what may be declared.
- Both copies of `plugins/*/skills/setup/SKILL.md`, kept identical and under their size limit: one sentence by the `--input` row.

**Owns.** `src/cli/warmup.ts`, `test/cli/warmup.test.ts`, `test/cli/warmup-reads.test.ts`, both setup skill copies and `test/harness/setup-skill.test.ts`.

**Done when.**
- A test with the slow tier deferred, as `test/cli` already fakes a held tier, sees the waiting line.
- The suggestion line's test pins the new clause.
- No real CLI and no model session is run.
- Lint, typecheck and the capped suite pass.

## 005-18 dogfooding

Use /worker.

**Outcome.** `lessons.md` reports spec 005's Proof bullets with evidence, apart from "since the release", which runs after the release.

**Read.**
- Spec 005, `## Testing`, the Proof bullets; D7 and D8.
- `evals/README.md`, and `evals/variants/d8-deny.json`.
- `research/e2e-setup.md`, Isolation: reuse `test/real-cli/isolated.ts`'s contract.
- `probes/adoption-baseline/`.
- The board row 005-18.

**Shape.** Research and measurement. It writes `lessons.md` and adds result files. It changes no product code.

**Isolation (hard).** Every subject session, and the eval runner that starts them, runs as `squeal-e2e`. Follow 005-17's contract:
- `sudo -n -u squeal-e2e`;
- the repository goes in through `git archive`;
- credentials are passed by name only;
- a Codex provider config is built with `codexConfig` into that user's own `CODEX_HOME`.

Never run the eval runner or an agent CLI as `agent`. `metric.mjs` over this repository's own transcripts is a read-only script of ours, and may run as `agent`.

**Plan first.** Send the coordinator a request with the session plan before the first session, and wait for its go. The plan covers:
- the cells: the conditions (the plugin alone, the reworded gate, D8 on), the harnesses and models, and the repetitions;
- the cezar part;
- the count, at most 40 sessions with retries.

The eval slot is shared with the other coordinators. Start each session only while the one-minute load is below the CPU count, and record the load per session.

**The parts.**
1. Spec 006's suite, its fixture made cold and slow, in both harnesses. Use the atomic tier through `run-baseline.mjs --atomic --variant <name> --tasks ...`, compared with `atomic-compare.mjs`. Measure:
   - how often D8 fires;
   - whether the agent accepts the answer or re-runs at once;
   - whether any claim after a deny is false.
2. One fresh copy of cezar, archived from `/home/agent/projects/cezar` HEAD into `squeal-e2e`'s home, set up with `squeal setup`. Measure:
   - the time until every test file is current;
   - the results reused;
   - the agent's claims about silence and about being done.

   Also answer the cezar coordinator's two questions: does `setup --plan` notice a suite no runner enumerates (its browser e2e with a bootstrap), and does the setup skill stop an agent from probing Squeal's internals? If cezar's browser suite cannot run as that user, say why, and measure what runs.
   Added by the human on 2026-10-14: cezar already has a `squeal.config.json`, written by agents (20880223, bbab66e9, af156319, 5dbb4b09), and its quality is unknown. So this part runs in two arms:
   - **(a) as it is:** `setup --plan --json` and `--check`, each key judged against the observed reads and what setup proposes;
   - **(b) fresh:** the config removed, then `squeal setup`.

   Compare the two configs key by key. Each difference is a finding for the human, with its evidence and its cost. Nothing is committed to cezar.
3. `metric.mjs` over this repository's sessions since `97144d9`.

**Owns.**
- `docs/specifications/005-agent-adoption/lessons.md`;
- `research/probes/dogfood/**` (scripts and redacted transcripts);
- new files under `evals/results/`. Never edit `TREND.md` or an existing results file: the coordinator regenerates `TREND.md`.

**Leaves alone.** `src/**`, `plugins/**`, `evals/lib/**`, `evals/bin/**`, `test/**` and the board. A defect found becomes a planned row, reported with its evidence.

**Done when.**
- `lessons.md` answers each Proof bullet, with the evidence and the n behind it. Lead with the effect size, then p and the n that would confirm it.
- Every session is listed with its model, load and result.
- A credential scan of everything committed finds nothing.
