# Research: existing agent-eval frameworks (006-15)

Topic `eval-frameworks` in `README.md`. Opus 5.5, 2026-10-11. Sources: each candidate's docs and source at the revisions under Sources, plus one probe of Inspect with the fake harness from `test/evals/fake-cell.ts`. No paid model session. The probe overwrote the host's real `~/.claude/settings.json` (Incident below). After that the coordinator allowed only reading, so every other finding is read in docs or source, not run.

**Verdict: keep.** Keep `evals/` as the runner and the results store, and adapt nothing now. Only two candidates run both real CLIs: Inspect with `inspect_swe`, and Harbor. Both need Docker (or Podman) to isolate a session, and this host has neither. Neither offers a hook to install a Claude Code or Codex plugin, and neither has a load gate. Neither tracks a trend across runs with a conditions fingerprint. Inspect also routes the CLI's model calls through its own proxy, which changes what is being measured. Everything a framework would not replace is ours either way: the fixture, the knobs, the plugin install, the expectations and the shell-aware grader. Together they are most of `evals/`.

## Answers

Y yes, P partly, N no. The findings below carry the tag and source for each cell.

| Requirement | Inspect 0.3.278 + inspect_swe 0.2.71 | Harbor 0.24.0 (Terminal-Bench 2.0) | promptfoo 0.124.1 | OpenAI Evals 3.0.1 | SWE-bench 5.0.2 | Braintrust / LangSmith |
| --- | --- | --- | --- | --- | --- | --- |
| 1 real CLIs, plugin, isolated home | P: real CLIs, model calls go through Inspect's proxy, no plugin hook; home isolated only in a container | P: real CLIs in a container, no plugin hook | P: Agent SDK and Codex SDK, not `claude -p` or `codex exec`; Claude plugins yes | N | N | N (no runner) |
| 2 pinned fixture, per-task state | Y: setup solver, `sandbox().exec` | P: a Dockerfile per task; state before the session needs a custom agent | P: `copy_working_dir`; knob hooks not determined | N | N | N |
| 3 full native transcript, timestamps | P: turned into Inspect events; native stream not kept | Y: stream-json, session JSONL, Codex rollout, plus ATIF | N: final text plus `toolCalls`, no timestamps | N | N | N |
| 4 our grader, ground truth after | Y: Python scorer can run `node` | Y: `tests/test.sh` writes `reward.json` | P: JS assertions | N | P: tests on a patch only | P: custom scorers, hosted |
| 5 reps, matrix, load gate, history, trend | P: `--epochs`, models; no load gate, no trend | P: `n_attempts`, `n_concurrent_trials`; no load gate, no trend | P: `--repeat`, `-j`, SQLite history; no load gate | N | N | P: history and comparison, hosted |
| 6 entirely local | P: telemetry opt-in; local sandbox wrote the real home | P: PostHog telemetry on by default | P: telemetry on by default | N: OpenAI API | Y | N: Enterprise self-host |
| 7 cost | Python ≥3.10, 234 MB, 82 packages, MIT, Docker | Python ≥3.12, Apache-2.0, LiteLLM, Supabase, Docker | Node ≥22.22, MIT, 76 deps, proprietary Agent SDK | stale since 2024-05 | Docker, about 120 GB | Enterprise plan |

## Findings

### Incident: inspect_swe writes the real home under the local sandbox

*Verified by experiment* (inspect-ai 0.3.278, inspect-swe 0.2.71, `--sandbox local`, model `mockllm/model`; `probes/eval-frameworks/inspect_cell.py`). The run passed `env={"HOME": <scratch>, "PATH": <fake bin first>}` to `claude_code(version="sandbox")`. It overwrote the real `~/.claude/settings.json` (mtime 15:11:11) with `{"apiKeyHelper": "echo <inspect_swe's dummy bridge key>"}`.

*Read in source* (inspect_swe `a54461e`, `_claude_code/claude_code.py` `_seed_claude_config`): `sbox.exec(["bash","-c",'mkdir -p "$HOME/.claude" && echo ... > "$HOME/.claude/settings.json"'])` runs with no `env`. The agent's `env` applies only to the later `claude` launch. Under Inspect's `local` sandbox, which "always executes as the current effective user" with the host environment (`docs/sandboxing.qmd`, `util/_sandbox/local.py`), `$HOME` is the real home.

For the same reason, `version="sandbox"` resolved `which claude` without the agent's `PATH` (`_util/agentbinary.py` line 129). It launched the host's real Claude Code, not the fake. Its model requests reached only Inspect's localhost proxy, which failed on a missing optional `anthropic` package, so no provider call was made. It also wrote to `~/.local/share/inspect_ai`, `~/.cache/inspect_swe`, `/var/tmp/.<hash>/inspect-sandbox-tools` and `/var/tmp/sandbox-services`. The coordinator restored the settings and removed those paths.

**What it means for adopting Inspect.** Only a container sandbox (`docker`, or `k8s` and others as extra packages) gives requirement 1's isolated home. That costs Docker Engine ≥24.0.6 and Compose ≥2.21.0 (`docs/sandboxing.qmd`), neither installed here. It also costs a per-cell image holding Node, the fixture's dependencies, both CLIs at pinned versions, the pinned plugin and the Squeal daemon. In a container Squeal runs under Linux in a fresh filesystem rather than the host's: a change of conditions that starts a new trend line (D6). The local sandbox is unusable for this suite. So is any framework code that writes to `$HOME` before the session's environment applies. Our runner's scratch `HOME`, `TMPDIR` and `CODEX_HOME` (D3) exist to prevent exactly that.

### 1. Real CLIs with our plugin in an isolated home

- **Inspect.** `inspect_swe` provides `claude_code()` and `codex_cli()` (also Gemini CLI, OpenCode and others). It runs the CLI inside a sandbox via `sandbox_agent_bridge()`, which "relays requests to the current Inspect model provider" (`docs/agent-bridge.qmd`, *read in official docs*). For Codex it writes its own `config.toml` with `model_provider = "openai-proxy"` at the bridge's port. For Claude Code it sets the effort as Inspect's `GenerateConfig.reasoning_effort`, "not a Claude Code CLI flag". It also sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` and blocking MCP connections by default. It always passes `--dangerously-skip-permissions` or an explicit `--permission-mode` (*read in source*, `codex_cli.py` 612–628, `claude_code.py`, `env.py`). Our D3 runs the CLI against the host's provider with `--effort` and our allow-list. Under Inspect the model would see a different request path, different settings and a different effort mechanism. There is no plugin option, only `skills` and `mcp_servers`, so the plugin would have to be baked into the image (*read in source*).
- **Harbor.** Its `claude_code` and `codex` agents install the CLI in the container (`npm install -g @anthropic-ai/claude-code[@ver]` or `bootstrap.sh`). It sets a per-trial `CLAUDE_CONFIG_DIR` and `CODEX_HOME`, passes `--effort` and `-c model_reasoning_effort`, and forwards `ANTHROPIC_BASE_URL` and the API key from the host to the CLI directly, with no proxy (*read in source*, `agents/installed/claude_code.py`, `codex.py`, `model_connection.py`). Neither file mentions plugins (grep), so the plugin needs a Dockerfile step or a custom agent. Every environment type is a container or a remote VM; `ssh` is a transport, not a host runner (`models/environment_type.py`).
- **promptfoo.** `anthropic:claude-agent-sdk` runs through the Agent SDK, with `plugins`, `setting_sources`, `path_to_claude_code_executable`, `effort` and `permission_mode`. `openai:codex-sdk` has `cli_env.CODEX_HOME`, `model_reasoning_effort` and `copy_working_dir` (*read in official docs*, `site/docs/providers/`). The Claude provider's env is `process.env < config.env < overrides` (*read in source*, `claude-agent-sdk.ts` 1481), so a parent's `CLAUDE*` and `CEZ_*` variables pass through unless removed. An SDK session is not the `claude -p` or `codex exec` session 005-06 measured.
- **OpenAI Evals** runs completion functions and solvers, with no CLI agent (*read in source*, `evals/completion_fns`, `evals/solvers`). **SWE-bench** grades patch predictions in Docker; `swebench infer` uses mini-SWE-agent, not our harnesses (*read in official docs*, README). **Braintrust** and **LangSmith** store results and run nothing.

### 2. Fixture and per-task state

Inspect: a `setup` solver and `sandbox().exec` run any command before the agent (*read in official docs*; the probe's setup commit ran, *verified by experiment*). Harbor: a task is a directory with a Dockerfile environment, an instruction and `tests/`. Stopping the daemon or making an outside edit after warm-up would need a custom agent or a setup step in the image (*read in official docs*, `core-concepts`, `tasks/`). promptfoo: `copy_working_dir` gives a fresh copy per step (*read in official docs*). Whether its extension hooks can stop a daemon before the session: not determined, because I did not read that part of the docs.

### 3. Transcript

Harbor tees `claude --output-format=stream-json` to `claude-code.txt`, keeps the session JSONL under `CLAUDE_CONFIG_DIR` and the Codex rollout under `$CODEX_HOME/sessions`, and converts both to ATIF (*read in source*). That covers what D3 keeps. Inspect's `LiveConsumer` turns the stream into Inspect events in its `.eval` log. I found no code keeping the native lines (*inferred*, from `claude_code.py`), which is why the probe's wrapper teed them. promptfoo returns the final text and `metadata.toolCalls` (`id`, `name`, `input`, `output`, `is_error`, `parentToolUseId`), with no timestamps (*read in official docs*; no "timestamp" in `claude-agent-sdk.ts`). Our grader needs those timestamps to place a command relative to the last edit (D4).

### 4. Grading

Inspect scorers are arbitrary Python and can run `node` on `evals/lib`. The probe's scorer does that, but the run failed before scoring, so this is *read in official docs*, not verified. Harbor's verifier runs `tests/test.sh` after the agent and reads `reward.json`, "labeled numeric metrics" (*read in official docs*, `tasks/verifier.mdx`). In either case our grader stays ours. None of the candidates parses shell commands: Codex's `bash -lc` wrapper, `&&`/`||`, heredocs, termination and `set -e` (D4; `evals/lib/shell.mjs`, `commands.mjs`). That parsing took three of the four review rounds (`status.md`).

### 5. Repetitions, matrix, load gate, history

Inspect: `--epochs`, several models at once, `max_samples` and `max_sandboxes`, local logs, and `evals_df()`/`samples_df()` for analysis (*read in official docs*). Harbor: `n_attempts`, `n_concurrent_trials` (default 4), multiple agents and models per job, local `jobs/` and a viewer (*read in official docs*, `jobs/configs.mdx`). promptfoo: `--repeat`, `-j`, history in SQLite under `~/.promptfoo` and `promptfoo view` (*read in official docs*). No candidate starts a cell only below a load threshold: no `loadavg` or `getloadavg` in the Inspect or Harbor source (*read in source*). None groups runs by a conditions fingerprint or flags a drop against the previous run with the same fingerprint (*inferred*, from their docs on logs and results). Braintrust and LangSmith compare experiments, but they are hosted.

### 6. Local only

- **Inspect** sends telemetry only when `INSPECT_TELEMETRY` names a hook package (*read in source*, `hooks/_legacy.py`). The model proxy would become Inspect's provider via `ANTHROPIC_BASE_URL` (`model_base_url`, *read in source*), which puts the proxy key in Inspect's process rather than a scrubbed cell.
- **Harbor** sends PostHog events unless `HARBOR_TELEMETRY` is `0/false/no/off/disabled`, and uploads to its Hub only with `--upload` or `harbor upload` (*read in source*, `telemetry.py`; *read in official docs*, `harbor-hub/upload.mdx`).
- **promptfoo** "collects basic usage telemetry by default" (`PROMPTFOO_DISABLE_TELEMETRY=1`), and shares only on `promptfoo share` (*read in official docs*, `configuration/telemetry.md`, `usage/sharing.md`).
- **Braintrust** self-hosting is Enterprise only, and its "control plane" stays hosted, with telemetry on by default. **LangSmith** self-hosting is "an add-on to the Enterprise plan" on Kubernetes (*read in official docs*, fetched 2026-10-11).

### 7. Cost

Inspect: Python ≥3.10, and `inspect-ai` plus `inspect-swe` installed in 9 s to a 234 MB venv of 82 packages (*verified by experiment*). MIT. Releases are frequent: 0.3.278 on 2026-10-09 (PyPI). Docker is required for isolation. Harbor: Python ≥3.12, Apache-2.0, depends on LiteLLM, FastAPI and Supabase, 0.24.0 on 2026-10-05; Docker or Podman. promptfoo: Node ≥22.22, MIT, 76 direct dependencies, plus `@anthropic-ai/claude-agent-sdk` under "a proprietary license" and `@openai/codex-sdk` (Apache-2.0). OpenAI Evals: last PyPI release 2024-05-01. SWE-bench: Docker and about 120 GB of disk (README). Terminal-Bench's own `tb` points new users to Harbor (README, `d28711d`).

## Recommendation for Squeal

**Keep** (cost: none now). `evals/` passed its review (006-11), and what no framework replaces stays ours: the fixture, the knobs, the plugin pin, the expectations, the grader (1,309 lines in `evals/lib`) and the trend (374). The part a framework could take is session spawning, scheduling and teardown: at most about 1,500 lines of `run-cell`, `run-baseline`, `session`, `scratch`, `daemon` and `prepare`, and in practice less, since the secret scan and the knobs stay (*inferred*).

**Adopt Harbor** (the closer fit) would replace that runner with containers. Cost: install Docker or Podman; one image per fixture commit with both CLIs, Node, the pinned plugin and Squeal; a custom agent or setup step for the knobs; `HARBOR_TELEMETRY=0` everywhere; our grader reading Harbor's trial directories. It also starts a new trend line and needs a new isolation review. Rows: an image builder, a custom agent with knobs, a grader adapter, then a review. It loses nothing in grading, but gives up the host-native conditions the pilot measured.

**Adopt Inspect** costs the same as Harbor plus the bridge: the model would be served through Inspect, not the CLI's own provider path. So it measures a different setup, and the effort level would be set a different way.

**Adapt** (a framework for history only): promptfoo, Braintrust and LangSmith add a viewer, not a better trend. Braintrust and LangSmith also fail requirement 6.

## Open questions

1. Whether to borrow `inspect_swe`'s defaults as deliberate conditions. `evals/` sets neither `CLAUDE_CODE_DISABLE_AUTO_MEMORY` nor blocking MCP connections (grep), so our cells run Claude Code's defaults; `env.py` says auto-memory adds about 3k prompt tokens and can spend turns, and measured 18.3% toolless first calls without blocking MCP when tools came over MCP (Squeal's do not). Owner: coordinator, as a D3 question; not a framework choice.
2. promptfoo's extension hooks for knobs: not determined (not read).

## Sources

- Inspect AI: `https://github.com/UKGovernmentBEIS/inspect_ai` at `a1dbea8` (2026-10-10); PyPI `inspect-ai` 0.3.278; `https://inspect.aisi.org.uk/` (`docs/sandboxing.qmd`, `agent-bridge.qmd`, `eval-logs.qmd`, `options.qmd`, `parallelism.qmd`, `dataframe.qmd`).
- inspect_swe: `https://github.com/meridianlabs-ai/inspect_swe` at `a54461e` (2026-10-05); PyPI `inspect-swe` 0.2.71.
- Harbor: `https://github.com/laude-institute/harbor` at `dc933be` (pyproject 0.24.0, as on PyPI); `docs-mintlify/`. Terminal-Bench: `https://github.com/laude-institute/terminal-bench` at `d28711d`.
- promptfoo: `https://github.com/promptfoo/promptfoo` at `b812375`, npm 0.124.1; `site/docs/providers/claude-agent-sdk.md`, `openai-codex-sdk.md`, `configuration/telemetry.md`, `usage/`.
- OpenAI Evals: `https://github.com/openai/evals` at `8eac7a7`; PyPI `evals` 3.0.1.post1. SWE-bench: `https://github.com/swe-bench/SWE-bench` at `02e7a74`; PyPI 5.0.2.
- Braintrust: `https://www.braintrust.dev/docs/guides/self-hosting`. LangSmith: `https://docs.langchain.com/langsmith/self-hosted` (both fetched 2026-10-11).
- Probe: `probes/eval-frameworks/` (README, `extract-fakes.mjs`, `inspect_cell.py`).
