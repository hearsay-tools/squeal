# Research brief for spec 006: model evals

## Topic: eval-frameworks

Added 2026-10-11 on the human's question: "I want to make sure we don't spend a meaningful amount of time fixing something that is already solved and widely adopted." 005-06 checked only Claude Code's `claude plugin eval` (rejected, `../../005-agent-adoption/research/model-evals.md` 5) and found that Codex has no eval command. No general agent-eval framework was surveyed before `evals/` was built.

Read `../spec.md` (goals, D1 to D8), `../status.md`, `evals/README.md`, and skim `evals/bin/run-cell.mjs`, `evals/lib/grade.mjs` and `evals/tasks/tasks.json`. That gives you what the suite does and what it cost to get right (`../reviews/wave-1*.md`, four review rounds on isolation and grading).

**What any replacement must do,** each a yes, no or partly, with the source:

1. Run the real Claude Code CLI and the real Codex CLI, with our plugin installed, in an isolated home per session, never the user's.
2. Set up each task from a pinned fixture commit, with per-task state before the session: the daemon stopped, an outside edit, a flake knob.
3. Capture the full transcript, with timestamps, in both harnesses' native formats.
4. Grade with our own code: per-task expectations over the transcript, plus ground truth from a test run after the session.
5. Run repetitions across a model matrix with a load gate, and keep a results history with a trend over runs and a conditions fingerprint.
6. Run entirely locally, uploading nothing. The repository is public, and the model provider is a private proxy.
7. Cost: install weight, runtime dependencies (Python, Docker), licence, and maintenance.

**Candidates,** at named versions, from their docs and source:

- Inspect (UK AISI, `inspect_ai`), including its sandboxes and its agent or CLI-agent support;
- Harbor and Terminal-Bench, which run CLI coding agents such as Claude Code and Codex in containers against test-verified tasks;
- promptfoo, including any agent-SDK providers;
- OpenAI Evals;
- the SWE-bench harness;
- Braintrust and LangSmith, for results history only;
- any other the candidates' own docs point to as running CLI coding agents.

For each candidate, one paragraph:
- what it would replace in `evals/` (runner, isolation, scheduling, results store, trend), and what we would still own (fixture, knobs, plugin install, expectations);
- the integration cost;
- what it would lose: our grader's shell parsing, the load gate, local-only operation.

**A cheap probe is welcome:** install the most promising candidate in a scratch directory and drive one fake-harness cell through it (`test/evals/fake-cell.ts` has fake `claude` and `codex` binaries). No paid model sessions.

**Recommendation:** adopt (replace `evals/` runner and results), adapt (use a framework for some layers), or keep. Give the evidence and the cost of each, and the rows a change would need.

Rules as in `../../005-agent-adoption/research/README.md`: one to three pages in `research/eval-frameworks.md`, every finding tagged (`verified by experiment`, `read in official docs`, `read in source code`, `inferred`) with its version, probes under `research/probes/eval-frameworks/` with a README, nothing outside this research folder, and no credential or private URL committed.
