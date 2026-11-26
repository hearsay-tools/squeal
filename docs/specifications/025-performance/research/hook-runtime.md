# Hook runtime and startup paths

Measure the shipped launcher path for the user-facing latency budget, and retain direct-bundle timings as a startup diagnostic. Keep the 80 ms budget. The evidence does not establish a new Stop runtime regression after 0.1.600.

Examined on 2026-11-26: **0.1.364** (`81a160214`), **0.1.600** (`e9c4a490c`) and **main / 0.1.636** (`be643e518`). Main has no `src`, plugin or harness-test difference from the brief's `792ee0ccb`. Measurements use Node **24.22.1**, a boat.dev default sandbox, four Ryzen 9 9950X vCPUs. Quiet measurement load was below 4; `CI` was unset. These are synthetic fixture sessions, not agent transcripts.

| Brief question | Answer and evidence tag |
|---|---|
| 1. Work after load and its history | **verified by experiment**, all three versions: one main-store open per ordinary hook; no Git child in these fixtures; more delivery bookkeeping by 0.1.600, almost identical IO at main. SQL, filesystem, syscall and CPU evidence below. |
| 2. Stop's extra 4–8 ms; SessionStart's 91 ms | **not determined** for the reported machine. **verified by experiment**, 600/main: no repeatable Stop increase here. Source adds header grouping, but its measured cost is too small to explain that increase alone. |
| 3. Harness startup and restore preload | **read in source code**, main: startup guards differ by harness. **verified by experiment**, Node 24.22.1: restore preload median cost is within noise; skipping proxy setup saves about 19 ms with proxy variables present. |
| 4. Other latency tests | **verified by experiment**, main: all four assertions pass. They measure runtime bundles, a worker, or bridges; Codex's test does not exercise its installed adapter. |
| 5. Test path versus user path; noise | **verified by experiment**, main: warm cache cuts several milliseconds from every cold process. Direct Stop p95 varies by 10 ms across three batches. Launcher Stop p95 varies by 2 ms. |

## Runtime work

**Verified by experiment, three versions.** Each trace uses that version's latency-test fixture: 50 files × 10 passing checks, plus its fixture check, with transitions before delivering calls. `strace -f -tt -T`, a separate `strace -f -c`, a CPU profile and a SQLite/FS preload cover every measured case. The preload counts executed statement methods and `exec`, including pragmas and transactions. Full SQL texts and file operations are retained in [trace-summary.json](probes/hook-latency/runtime/results/trace-summary.json). Counts describe this fixture, not every possible policy.

In each tuple below, order is **364 / 600 / main**. `read/stat` counts JS synchronous file reads and stat/lstat/existence calls, including bundle and stdin reads. Native SQLite IO is separate in strace. Connect counts include unsuccessful attempts, not successful protocol exchanges.

| Claude Code case | SQL calls | read/stat | Socket connects |
|---|---:|---|---:|
| SessionStart, already registered | 1582 / 109 / 109 | 13/20 → 15/10 → 15/10 | 2 / 3 / 3 |
| PostToolBatch, delivers | 94 / 116 / 116 | 7/4 → 14/9 → 14/9 | 0 / 1 / 1 |
| PreToolUse, edit | 21 / 33 / 33 | 4/3 → 7/6 → 7/6 | 0 / 1 / 1 |
| PreToolUse, silent Bash | 16 / 26 / 28 | 4/3 → 5/4 → 5/4 | 0 / 1 / 1 |
| PreToolUse, denied test command | 37 / 45 / 45 | 7/3 → 8/4 → 8/4 | 0 / 1 / 1 |
| Stop, delivers | 95 / 115 / 115 | 7/3 → 11/4 → 11/4 | 0 / 1 / 1 |
| Stop, silent | 98 / 119 / 119 | 7/3 → 11/4 → 11/4 | 0 / 1 / 1 |
| UserPromptSubmit, delivers | 41 / 61 / 61 | 5/4 → 8/5 → 8/5 | 0 / 1 / 1 |
| UserPromptSubmit, silent | 38 / 57 / 57 | 5/4 → 8/5 → 8/5 | 0 / 1 / 1 |
| SessionEnd | 56 / 67 / 67 | 5/5 → 6/6 → 6/6 | 0 / 1 / 1 |
| Waiter, noninteractive early exit | 0 / 0 / 0 | 2/5 in all | 0 / 0 / 0 |
| SessionStart, spawn stand-in | 1618 / 123 / 124 | 13/20 → 23/12 → 23/12 | 1 / 1 / 1 |

Every ordinary case opens `store.sqlite` once. Waiter opens none. Spawn opens it twice across parent and child and starts one Node child. There are **no Git children**. The normal cases start no child beyond the measured Node process. Policy reads are repeated: current Stop reads `squeal.config.json` seven times, SessionStart nine. The current session-root file is lstat'ed/read; SessionStart also reads Git HEAD files and `/proc` ancestry. Code/lint databases are disabled or absent in this fixture.

**Read in source code, main** ([hook context](../../../../src/harness/shared/hook.ts), [store open](../../../../src/core/store/open.ts), [sent store](../../../../src/core/delivery/sent-store.ts)): hooks open the main store read-write, read schema/worktree state and apply connection pragmas. PreToolUse resumes a turn or checks a regression/test-command denial. PostToolBatch reads HEAD, then delivers changes. Prompt starts a turn. Stop reads states, prepares news, decides required checks and ends a silent turn. SessionEnd unregisters consumers. Registration writes consumer views and marks the registration owed/handed over before daemon ensure.

**Read in source code, 364→600 history.** `ddf12317f` replaced 501 × three consumer-view seed statements with a bulk seed. `fee2e5b96` added held delivery writes; `09f58b3c6` routes writes through daemon leases/batches; `b5f1ec401`/`f864134bf` added code-store preflight. `ff50d4069`/`d02a0ecdd` added registration HEAD and conditional Stop Git proof. `aaafd1c8c`/`543b94f55` added post-tool HEAD synchronization. `3beae0a2c`/`0090d236b`/`19fdcbdfb` added required-group/waiting-entry bookkeeping. `88410372e` registers before spawn; `ba3d828cb` persists unhanded registration. `f87845c97` caches Stop's known-state list; `c4a955f7f` speeds current-schema store opening.

**Read in source code, main:** a real serving daemon adds lease/batch/write-status exchanges. The fixture's `liveSocket` only accepts and closes; its stored writer socket is absent, so measured writes fall back locally. Conditional waits omitted by these settled fixtures include Stop pending checks (100 ms polling, 1500 ms cap), waiting-entry record (25 ms polling, 500 ms cap), post-tool HEAD synchronization (500 ms), and Git no-edit proof (1000 ms bound). Writer requests have 250/1000 ms bounds. Strace's large aggregate `futex` times include Node's helper threads; they are not evidence of a hook policy wait. The interactive waiter and separate `stop-slow` entry are not measured by the latency test.

## What changed in elapsed time

**Verified by experiment.** Three consecutive batches per version, 20 fresh processes per case, cache absent. Cells show the range of batch **p50 / p95**, in ms. Each version uses its own compatible fixture; this is not a bisect.

| Hook | 0.1.364 | 0.1.600 | Main |
|---|---|---|---|
| SessionStart | 37–39 / 41–43 | 43–45 / 46–48 | 42–44 / 45–49 |
| PreToolUse, edit | 29–32 / 33–35 | 36–39 / 43–47 | 37–38 / 41–42 |
| Stop, delivers | 37–42 / 39–44 | 45–51 / 48–53 | 47–50 / 50–52 |
| Stop, silent | 37–41 / 40–46 | 46–51 / 49–54 | 47–48 / 48–52 |
| UserPromptSubmit | 35–38 / 41–43 | 40–47 / 44–52 | 41–43 / 44–49 |

A separate minimal preload and marker immediately before `runMain` measure **work after module evaluation**, without strace, CPU profiling or SQL wrappers. Stop delivering p50/p95 is **12.8/13.6 → 20.8/23.9 → 19.8/23.6 ms**. Silent Stop is **12.5/13.8 → 21.0/24.4 → 21.0/25.1**. SessionStart is **12.5/13.2 → 15.2/18.4 → 16.2/17.7**. Thus the 364→600 increase includes runtime work, not just loading. These separately sampled phases must not be subtracted from percentile totals as an exact decomposition. All cases are in [phase-summary.json](probes/hook-latency/runtime/results/phase-summary.json).

**Read in source code, 600→main:** direct Claude hook, shared Stop/SessionStart and store-open paths are unchanged. `dbd09917b` converts list-based headers through `worktreeStatesOf`: JSON grouping, per-file arrays and tallies. **Verified by experiment:** the same 500-state header input gives equal output and costs **0.112/0.262 ms** p50/p95 at 600 versus **0.171/0.358 ms** at main. This is a small cost, not proof of a 4–8 ms regression. CPU profiles show compiler, SQLite and GC work; they are sampled under instrumentation and cannot assign a precise wall-time share.

**Not determined:** the cause of the brief's 91 ms SessionStart sample and the claimed post-600 Stop step. Neither repeats here; the original machine, Node version, scheduling and GC remain uncontrolled differences. Do not identify a culprit commit from these data. The old spawn case also exposes the test's selection effect: its first phase-probe round spends about 763 ms after load, but the test reports the passing retry around 41 ms.

## Startup paths and the other harness tests

**Read in source code, main.**

| Harness | Real startup | What its latency test measures |
|---|---|---|
| Claude Code | `hooks/run` sets an own compile cache if none is set, carries the proxy switch past startup and restores it with `--import`. Per-tool shell guard can exit before Node. | `runBundle` directly starts Node with only PATH/HOME and supplied fixture variables. No cache, proxy or shell guard. |
| Codex | Fixed Node adapter selects/pins a runtime and calls `enableCompileCache` before dynamically importing `runtime.mjs`. It cannot suppress proxy setup that already occurred at Node boot. | Fresh individual runtime hook bundles; omits adapter selection, pin reads, runtime import/cache and inherited proxy environment. |
| Pi | A persistent worker thread; extension gives it no custom environment/cache or proxy guard. It inherits host settings. | Same worker/host protocol, but fresh workers get a minimal environment. Tests omit production verdict-slot wiring and host startup. |
| OpenCode | Bun plugin spawns Node bridge through `callBridge`. `bridgeStart` carries/restores proxy. It sets no compile cache itself; inherits one if present. | Uses actual `callBridge` and environment inheritance, but from a Node test host, beside direct Codex runtime bundles. |
| Antigravity | `hooks/run` uses the same cache/proxy guard as Claude Code. | Direct Node runtime bundles, bypassing the launcher. |

**Verified by experiment, main:** all five latency-test probes pass, with production budgets unchanged. Codex Stop needed two rounds; the others passed their first rounds. The generated test copies preserve cases and assertions; OpenCode adds a p50 column. These runs are explicit research measurements without a validating sandbox Squeal daemon. Each direct Vitest invocation has `timeout 600`.

| Other test | Measured p50/p95 ms; full per-case table |
|---|---|
| Codex | SessionStart **49/53**, edit **43/49**, Stop **55/59**, silent Stop **54/60**; all cases in [codex.log](probes/hook-latency/runtime/results/codex.log). |
| Pi | Ping **0.0/0.1**, delivery **3.3/5.1**, silent **2.6/3.3**, fresh worker **43.0/46.9**; [pi.log](probes/hook-latency/runtime/results/pi.log). |
| OpenCode | Register **46/52**, prompt **45/57**, edit **42/48**, Stop **56/60**, silent Stop **56/61**; [opencode.log](probes/hook-latency/runtime/results/opencode.log). Every bridge p95 is within the test's 10 ms margin over Codex. |
| Antigravity | SessionStart **47/54**, first invocation **46/48**, after-tools **45/48**, silent invocation **43/46**, denying write **46/49**, silent command **36/39**, Stop **53/57**, silent Stop **53/54**; [antigravity.log](probes/hook-latency/runtime/results/antigravity.log). |

**Verified by experiment, Node 24.22.1:** 60 interleaved empty-process samples after five warmups, with inert HTTP/HTTPS proxy URLs present, give cache-only **15.73/19.38 ms**, restore preload **15.88/19.00**, and proxy enabled at boot **35.22/40.64**. Median restore overhead is **0.15 ms**, within noise; avoiding proxy setup saves **19.34 ms** versus restore. With no proxy URLs, all modes were about 12 ms median. No HTTP request was made. This does not quantify Node 22/26 or Codex adapter overhead.

## Choice of test path

**Verified by experiment, main.** Three batches per mode, 20 fresh processes each. Cache modes reuse one writable cache; this measures warm compiled code, not the first installation. Launcher measurements execute `hooks/run node <bundle>` with the same fixture environment. They omit the outer harness shell, the per-tool `--if-squeal` guard and real daemon acknowledgements.

| Path | SessionStart p50 / p95 range | Stop p50 / p95 range |
|---|---|---|
| Direct `runBundle`, no cache | 44–47 / 47–50 | 49–55 / 53–63 |
| Direct, warm cache | 37–40 / 41–43 | 42–45 / 46–50 |
| `hooks/run`, warm cache | 40–42 / 42–45 | 42–44 / 46–48 |
| `hooks/run`, cache + carried proxy switch | 36–38 / 40–41 | 43–45 / 47–48 |

Batch order was fixed, so differences of a few ms between cached modes are not causal estimates. The test accepts the best of up to three rounds; the ranges above preserve between-batch noise. Warm compiled code in a fresh process is still a cold process, but not a cold cache. A new release or unwritable/disabled cache can pay more.

The required benchmark was run first via `bench/boat-run.sh --ref squeal--v0.1.600 --ref HEAD --cells ref --steps 1`, in a scratch checkout to respect ownership. [Scorecard and raw data](probes/hook-latency/runtime/benchmark/scorecard.md): correctness PASS, score **97→97**, pre-tool p95 **41→40 ms**, post-tool **41→47**, SessionStart **77→94**. This deliberately short cell exercises a real daemon but has too few hook samples to establish a tail change. Earlier [627/631 scorecard](../../../../bench/results/2026-11-24-0.1.627-vs-0.1.631-default-AMD-Ryzen-7-9700X-8-Core-Processor/scorecard.md) and raw synthetic session logs supplied the benchmark context. Both new sandboxes were deleted.

**Recommendation [inferred]:** let the human choose whether 80 ms means installed-user latency or uncached bundle latency. For the former, exercise each harness's shipped dispatch path and state the cache/environment conditions. Keep uncached measurements visible because they expose release startup growth. These data support a substantial startup saving; they do not authorize loosening the budget or claiming that runtime work is free.

Open questions: reproduce the 91 ms spike on the original CPU; measure cold-cache installation and Node 22/26; measure Codex's installed adapter and Pi's inherited proxy environment. Contended writer/policy waits need the existing benchmark cells, not the closing-socket fixture.

Sources: repository at the commits above; `test/harness/latency.test.ts`, `bundle-helpers.ts` and the four named harness tests; `plugins/{claude-code,antigravity}/hooks/run`; `src/harness/codex/adapter/index.ts`, `pi/entries/extension.ts`, `opencode/bridge-client.ts`; `src/harness/shared/{stop,stop-decide,no-edit,ensure}.ts`; `src/core/delivery/daemon-writer.ts`; `src/core/state/{header,header-part,file-class}.ts`. [Probe instructions and evidence](probes/hook-latency/runtime/README.md) reproduce the experiments. No external API claim relies on recall.
