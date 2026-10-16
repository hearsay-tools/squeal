#!/usr/bin/env python3
"""Lift spec 001's text into the three subsystem specs 011, 012 and 013.

Migration tool for `../../split-proposal.md`, section 6 step 3. Re-runnable: it
reads `001-core-loop/spec.md`, routes every content line to exactly one new
spec by the MAP below, writes the three `spec.md` files, and checks that every
content line of 001 appears verbatim exactly once across them. Run from
anywhere: `python3 lift.py <sha-of-001-spec>`. Writes `coverage.txt` beside it.
"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
SPECS = ROOT / "docs" / "specifications"
SRC = SPECS / "001-core-loop" / "spec.md"
SHA = sys.argv[1] if len(sys.argv) > 1 else "HEAD"

lines = SRC.read_text().split("\n")
assert lines[0] == "# 001 Core validation loop", lines[0]

# ---------------------------------------------------------------- routing map
# line number (1-based, as in `cat -n spec.md` at SHA) -> (spec, section key)
C, CC, V = "011", "012", "013"


def rng(a: int, b: int) -> list[int]:
    return list(range(a, b + 1))


MAP: dict[int, tuple[str, str]] = {}


def put(spec: str, key: str, *nums: int | list[int]) -> None:
    for n in nums:
        for k in n if isinstance(n, list) else [n]:
            assert k not in MAP, f"line {k} mapped twice"
            MAP[k] = (spec, key)


# Problem, goals, non-goals, testing, open questions, references
put(C, "problem", 7, 9)
put(C, "goals", 13, rng(15, 21))
put(C, "nongoals", rng(25, 30), 32)
put(CC, "nongoals", 31)
put(C, "testing", 239, 241, 243)
put(V, "testing", 240)
put(CC, "testing", 242, 244)
put(C, "open", 248, 250, 251, 254, 256, 258)
put(CC, "open", 252, 255)
put(V, "open", 253, 257)
put(C, "refs", 262, 263, 264)
# D1
put(C, "C1", 38, 40, 42, 43, 44, 48)
put(C, "C8", 46)
# D2
put(C, "C2", 52, 54, 56, 58, 60)
# D3
put(C, "C3", 64, 66, 67, 68, 72, 73, 75)
put(C, "C11", 69, 71)
# D4
put(V, "V1", 79)
put(V, "V2", 81)
put(V, "V3", 82, 83, 85)
put(C, "C12", 84)
put(V, "V4", 86, 92)
put(V, "V5", 87, 88, 90)
# D5
put(C, "C4", 96, 98, rng(100, 104), 106, 108, 110, 114, 116, 118, 122, 124, 126)
put(V, "V7", 112)
put(C, "C11", 120)
# D6
put(C, "C5", 130, 132, 134, 136, 137, 139, 141)
# D7
put(C, "C6", 145, 147, 149)
# D8
put(C, "C7", 153, 155, 157, 159, 161)
# D9
put(CC, "CC1", 165, 167, 179, 180, 182)
put(CC, "CC2", rng(169, 176))
put(C, "C8", 177, 186)
put(CC, "CC3", 178)
put(C, "C14", 184)
put(CC, "CC4", 188)
# D10
put(C, "C9", 192, 194, 196)
# D11
put(C, "C10", 200, rng(202, 208), 210, 212, rng(214, 221), 223)
put(V, "V9", 209)
# D12
put(C, "C13", rng(227, 235))

# ------------------------------------------------------------ content lines
HEADING = re.compile(r"^#{1,6} ")
content = [
    n
    for n in range(1, len(lines) + 1)
    if lines[n - 1].strip() and not HEADING.match(lines[n - 1]) and n not in (1, 3)
]
missing = [n for n in content if n not in MAP]
extra = [n for n in MAP if n not in content]
assert not missing, f"unmapped content lines: {missing}"
assert not extra, f"mapped non-content lines: {extra}"

# 001 heading per line, for tags and the crosswalk
heading_of: dict[int, str] = {}
current = ""
for n, text in enumerate(lines, 1):
    if HEADING.match(text):
        current = text.lstrip("# ").strip()
        current = re.sub(r"^(D\d+)\..*", r"\1", current)
    heading_of[n] = current

# ------------------------------------------------------------------ notes
# emitted right after the run that holds the line; new text, never 001's
NOTES: dict[int, str] = {
    9: "**Note (2026-10-17).** \"One test ecosystem (Vitest), one harness (Claude Code)\" describes v1 as shipped on 2026-10-06. Since then: Codex (002), node:test (003), slow suites (004), pytest (007), OpenCode (008), Pi (009). The interaction model is unchanged.",
    26: "**Note.** This non-goal was amended by 001-132 (D4 \"Observed runtime inputs\", now C12): while policy `observe.runtimeInputs` holds, the project paths a run reads, stats, lists, loads or executes join the closure. Environment variables and network stay outside it.",
    28: "**Note.** This non-goal and the one before it are v1's. node:test is spec 003, pytest 007; Codex 002, OpenCode 008, Pi 009. The adapter contracts they implement are C8 and C14.",
    67: "**Note.** \"Per Vitest project\" reads \"per runner project\" since 003 D3 and 007: each runner reports its own environment files and packages through `environment()` (C14). The Vitest-specific inputs named in this bullet are the Vitest adapter's to supply (013 V6); the npm hidden-lockfile rule and the package-folder fallback are C11's.",
    116: "**Note.** The Vitest-specific cases in this paragraph (a `globalSetup` that throws, an ENOENT under the instance's temp directory, a Vite module runner error, an instance recreated when a lockfile appears) are described from the adapter's side in 013 V8. The paragraph that followed here in 001, \"What the Vitest adapter's calls exclude\", is 013 V7. The install wait is C11.",
    196: "**Note.** The sentences about an interactive main agent's idle waiter and its lock file describe Claude Code's liveness mechanism (012 CC4); the daemon's expiry rule stays here.",
    209: "**Note.** 001 listed this key between `delivery.uncoveredEdits` and `daemon.idleExitMinutes` in the policy list that is 011 C10. The list there says it is this spec's.",
    210: "**Note.** `vitest.excludeProjects`, which 001 listed here, is 013 V9. This list is 001's keys only; the catalogue of every `squeal.config.json` key and its owner: `nodeTest` (003 D1), `slow`, `stop.requireSlowSuite` (004 D7, D9), `pytest` (007), `testCommand.denyWhenCurrent` (005 D8), `vitest.excludeProjects` (013 V9), the rest here.",
    223: "**Note.** Three things in this paragraph have moved on. \"A project without Vitest is a runner failure state\" was replaced by 003 D7's selection rule: the daemon builds the runners it detects or is configured for, and that note applies only when none is. \"The Claude Code plugin\" reads \"the harness plugin\" (002 D8). The sentences on loading Vitest from the project and `update: 'none'` are the Vitest adapter's to implement (013 V9); Fidelity and Inherited environment are rules for every runner and stay here, with the recorder in C12.",
    228: "**Note.** The two bullets above name Vitest; the rule holds for every runner, and the adapter-side cases are 013 V8. The process-reaping bullet below says 004-18 \"replaces\" the bare mark with a mark per lane: 004-18 is done, so the per-lane mark is the current state.",
    184: "**Note.** The three-operation sentence is 001's; the contract as implemented has the members listed above.",
    243: "**Note.** Decided by the human 2026-10-17 (Q5): these suites run once per hook plugin (`test/e2e/plugins.ts`: Claude Code and Codex) and are this spec's proof of the hook contract (C8). Each harness spec owns its row in that table and its fixtures.",
}

# ------------------------------------------------------------ spec layouts
Section = tuple[str, str, str | None, str | None]  # key, heading, intro, outro

CORE_SECTIONS: list[Section] = [
    ("C1", "### C1. Workspace, repository, store", None, None),
    ("C2", "### C2. Watcher and revisions", None, None),
    ("C3", "### C3. Keys and closures", None, None),
    ("C4", "### C4. Scheduler and result validity", None, None),
    ("C5", "### C5. State, transitions and delivery views", None, None),
    ("C6", "### C6. Status", None, None),
    ("C7", "### C7. Shared store", None, None),
    (
        "C8",
        "### C8. Hook contract",
        "Every harness adapter implements one contract against the core, in two layers. The programmatic layer is `HarnessDelivery` (`src/core/types/delivery.ts`): `register`, `unregister`, `onToolBoundary`, `peek`, `waitForDelta`, `startTurn`, `endTurn` and `status`, over a `Consumer` of `(worktree, session id, agent id or \"main\")`. The behavioural layer is what `src/harness/shared/*` implements for every harness and what each harness's events must map onto: a registration seeds the consumer's view and injects the full header and the primer (C5, C10); each tool boundary delivers the delta and, when the recorded heartbeat is stale, ensures a daemon (C9); a seen regression denies one edit once, through a peek that consumes only regression entries; an end of turn speaks only with news and otherwise records the files pending for the idle wake; the consumer's turn state lives in `meta`; liveness is told once per change, with the \"starting\" rule for a daemon just spawned; after an edit no listed test reads, one uncovered-edit line; the harness process is recorded at each registration (below); a hook newer than the daemon asks it to step down (C9); every hook of a session uses the root its session start resolved (below); a hook that fails internally exits 0 with no output and never blocks past its budget (goal 6). The reference wording of these rules is the Claude Code adapter's (012 CC2), where 001 wrote them per hook event; 002 D3 to D5, 008 and 009 map the same rules onto Codex, OpenCode and Pi. A change to a rule here is a change for every harness and goes through this spec; a change to one harness's mapping goes through that harness's spec. Owner decided by the human on 2026-10-16 (split proposal, Q2).",
        None,
    ),
    ("C9", "### C9. Daemon lifecycle", None, None),
    ("C10", "### C10. Policy and capacity", None, None),
    (
        "C11",
        "### C11. Node ecosystem: installs and installed dependencies",
        "The rules below are Node-specific and serve the Vitest and node:test runners alike; pytest has its own environment rules (007). They stay in the core spec because their code is core code (`src/core/scheduler/install.ts`, `install-stamp.ts`, `src/core/keys/hidden-lockfile.ts`, `packages.ts`, `environment.ts`) consumed through one contract field, `RunnerClosure.packages` (C14). Decided by the human on 2026-10-17 (split proposal, Q4). Which packages a test file reaches is each runner's to report: 013 V6 for Vitest, 003 D3 for node:test.",
        None,
    ),
    (
        "C12",
        "### C12. Runtime-input recorder",
        "The recorder is core code (`src/runners/observe/*`) delivered by every runner that can carry it: Vitest's workers (013 V10), node:test's processes (003 D5) and pytest's warm-up. Its form at each spawn, `--import` or `--require`, is C10's Fidelity rule. Owner decided by the human on 2026-10-16 (split proposal, Q3). The paragraph below is 001's description of it, written inside the Vitest adapter section.",
        None,
    ),
    ("C13", "### C13. Error handling", None, None),
    (
        "C14",
        "### C14. Adapter contracts",
        "`RunnerAdapter` (`src/core/types/runner.ts`): `name`, `adapterVersion`, `invalidate(paths)` with the kinds edit, add, delete and touch, `recheck?`, `affected`, `closure` (with `RunnerClosure.packages`), `enumerate`, `testFiles`, `omittedTestFiles?`, `environment` (`RunnerEnvironment`, its files and packages), `slowWidth?`, `run(files, RunOptions) -> RunReport` (`end`, `durationMs`, `completedFiles`, `results`, `fileErrors`, `failure`, and the optional `fileDurations`, `observed`, `reads`), `lane?`, `releaseLane?`, `close`. The daemon holds one adapter per detected or configured runner behind a composite (003 D7). A runner's adapter version re-keys that runner's checks alone; `KEY_FORMAT_VERSION` re-keys every runner (C3). Check identity is `(project name, relative test path, fullName)` with the duplicate-name suffix and the error caps stated in 013 V4. The harness side is C8.",
        None,
    ),
]

CC_SECTIONS: list[Section] = [
    ("CC1", "### CC1. Plugin, install and files", None, None),
    ("CC2", "### CC2. Hook events", "Each event below maps Claude Code's hook onto the hook contract (011 C8). The rules stated inside these bullets that hold for every harness are 011's; their wording is kept here because 001 wrote them per event.", None),
    ("CC3", "### CC3. Idle waiter", None, None),
    (
        "CC4",
        "### CC4. Interactive liveness and lifecycle integration",
        "The daemon's rules are 011 C9, verbatim there: an interactive main agent's liveness is its idle waiter, whose lock the OS releases when Claude Code kills it, so a consumer with a free waiter lock and no delivery or sign of life for 10 minutes expires; departures, step-down and `squeal stop` are the daemon's. Claude Code's side is the waiter lock (`src/core/waiter-lock`), the per-session root of 011 C8, and the leaving mark SubagentStop writes:",
        None,
    ),
]

V_SECTIONS: list[Section] = [
    ("V1", "### V1. Instance and adapter version", None, None),
    ("V2", "### V2. Invalidation", None, None),
    ("V3", "### V3. Affected, closure, enumerate", None, None),
    ("V4", "### V4. Runs, results and check identity", None, None),
    ("V5", "### V5. Bytes Vite read, touched files, the optimizer", None, None),
    (
        "V6",
        "### V6. Environment inputs and packages",
        "Vitest's inputs to the environment hash are listed inside 011 C3's environment-hash bullet: the resolved Vitest config, the config file's contents and its `configFileDependencies`, the closure of every `setupFiles` and `globalSetup` entry with the resolution candidates of its unresolved imports, the packages the resolved config names by string, the reporters given as packages and the environment package. They reach the core as `RunnerEnvironment.files` and `RunnerEnvironment.packages` from `environment()`, and a test file's packages as `RunnerClosure.packages` from `closure()` (V3). How packages become a key segment, and when a file falls back to the whole fingerprint, is 011 C11; this adapter's part of that rule is what it reports: the package entries Vite resolved, the specifiers Vite left bare, the literal `require` targets of the source scan with the importer's directory, and the docblock environment with the project root.",
        None,
    ),
    ("V7", "### V7. Runs and the runner part: the gate", None, None),
    (
        "V8",
        "### V8. Runner failures and the failed start",
        "A runner call that fails is a state, never a skip: the rule and its consequences are 011 C4's paragraph on it. This adapter's cases in that paragraph: a run that rejects before any test file reports (a `globalSetup` that throws) is a failed start, its instance closed and the next call starting a new one, because Vitest marks a project's `globalSetup` done before it runs it (V1); an ENOENT under the instance's own temp directory, or a Vite module runner error whose message and stack name no project file, ends the run `crashed`; the instance is recreated when an installed lockfile appears or changes, with `vitest/node` imported again from the worktree; a Vitest at the same resolved path keeps the module already imported, and a new version there needs a daemon restart. 011 C13's first two bullets state the untrusted-run and config-change rules; the setup check a failed start feeds is 011 C5.",
        None,
    ),
    (
        "V9",
        "### V9. Policy and capacity",
        None,
        "Two more rules of 011 C10 are this adapter's to implement. The runner ceiling (C10 Capacity, \"Runner ceiling\"): each backlog or checkpoint tier's workers come from its grant under the project's own resolved `maxWorkers`, at least 2 unless the project set 1, and the warm instance is resized before each run, never recreated. The loading rule in C10's last paragraph: Vitest is loaded from the project under validation, resolved from the worktree root and imported lazily, never from Squeal's own installation; only the project's own configuration runs inside the worktree; `update: 'none'` prevents snapshot writes; the workers' environment additions are the recorder's and the child marker's (V10).",
    ),
    (
        "V10",
        "### V10. Recorder and child-marker delivery",
        "The recorder (011 C12) and the child marker (011 C13, the process-reaping bullet) reach Vitest's workers through `createVitest`'s `env` option, which Vitest spreads into the workers of every project in both pools: the recorder as `--import` of its `file:` URL, or `--require` where C10's Fidelity rule says so, ahead of the daemon's own `NODE_OPTIONS`, with its settings in `SQUEAL_OBSERVE`; and `SQUEAL_DAEMON_CHILD=<token>:<lane>`. Neither enters the resolved config 011 C3 hashes. `fsModuleCache` is off so that every transform goes through the stamped `load` (V5).",
        None,
    ),
]

SEAMS = {
    C: [
        "The daemon names every runner: `src/core/daemon/daemon.ts` builds the Vitest adapter and its slow instance, `src/core/daemon/runner.ts` holds the Vitest config-name regex and `vitestDetected`, `node-test-runners.ts` and `pytest-runners.ts` the others.",
        "`src/core/delivery/own-edit.ts` parses the reason written by `src/runners/vitest/moved.ts` (001 quality scan 2026-10-2, slice 1).",
        "`src/core/slow/stop-wait.ts` declares `StopWaitHarness = \"claude-code\" | \"codex\" | \"pi\"`; C10's inherited-environment strip list names each harness's variables.",
        "The Vitest adapter imports `core/daemon/policy`, `core/state/fingerprint`, `core/state/optimizer-note`, `core/keys`, `core/hash` and `core/run-log`, past `RunnerAdapter`.",
        "`src/core/status/run-log.ts` knows `vitest.log` and a `not-vitest` state; `src/core/state/optimizer-note.ts` is Vitest text; `src/core/status/snapshot.ts` renders `vitest.excludeProjects`.",
        "`src/cli` mixes owners: `init.ts` (012 and 002), `status-command.ts` imports `harness/codex/command`, `node-test-seed.ts` (003), `pytest-seed.ts` (007), `setup/*`, `update.ts`, `warmup.ts` (005).",
        "C10 is not the full policy catalogue; the note under its key list names the keys other specs own.",
        "Goals 1 to 4 are proven through the hook contract on two plugins (Testing), never through a harness-neutral consumer.",
    ],
    CC: [
        "The rules inside CC2's bullets that hold for every harness are 011 C8's; a change to one of them is a change for Codex, OpenCode and Pi too.",
        "`src/cli/init.ts` defaults to the Claude Code marketplace and takes `--harness codex` (002 D1); install, the launcher and `squeal setup` are 005 D3's.",
        "The primer's facts are 011's (C8, C10), its wording 005's (D4, D6), and `plugins/claude-code/skills/squeal` is one of four copies (human, 2026-10-12).",
        "The waiter lock lives in core (`src/core/waiter-lock`) and 011 C9 reads it for the 10-minute expiry.",
    ],
    V: [
        "Core code names this adapter: `src/core/daemon/daemon.ts`, `runner.ts`, `policy.ts`, `status/snapshot.ts`, `status/run-log.ts`, `state/optimizer-note.ts`, `delivery/own-edit.ts` (011, Known seams).",
        "This adapter reaches past `RunnerAdapter` into `core/daemon/policy`, `core/state/fingerprint`, `core/state/optimizer-note`, `core/keys`, `core/hash` and `core/run-log`.",
        "The scheduler's text (011 C4) carries this adapter's measurements and its gate as evidence; the gate paragraph itself is V7.",
        "The install wait and the dependency segments (011 C11) are Node rules shared with node:test; `src/runners/vitest/packages.ts` is this adapter's half of them.",
    ],
}

RESEARCH = {
    C: [
        "result-fingerprinting-prior-art", "watcher-daemon-and-shared-store", "pull-advances-push",
        "per-package-keys", "harness-process-liveness", "process-group-tests-under-squeal",
        "observed-runtime-inputs", "shared-runs", "wait-from-store", "nested-worktree-watch",
        "injected-environment", "host-capacity", "environment-failures", "daemon-sigkill",
        "daemon-under-harnesses", "fresh-worktree-reuse", "slow-claims",
    ],
    CC: ["claude-code-integration", "uncovered-suites", "uncovered-trust", "primer-skill-writing"],
    V: ["vitest-internals", "cezar-e2e-setup", "revert-restore-pass", "revert-restore-pass-2"],
}

META = {
    C: dict(
        folder="011-core",
        title="# 011 Core: observation, keys, scheduling, state, status, store, daemon, policy",
        sections=CORE_SECTIONS,
        intro="The harness-neutral and runner-neutral subsystem: worktrees, repository and store, the watcher and revisions, content keys and closures, scheduling and validity, known states and delivery views, status, the daemon's lifecycle, policy and capacity, error handling, and the two adapter contracts every runner and harness implements. Excluded: any hook event name, plugin manifest or packaging (012, 002, 008, 009); anything that reads Vite's module graph or calls `createVitest` (013); the slow tier's rules (004); node:test (003) and pytest (007); wording 005 owns; evals (006); CI (010).",
        refs=[
            "- Split proposal and decisions: `../001-core-loop/split-proposal.md`",
            "- 001's amendment log, reviews, task notes and lessons: `../001-core-loop/`",
            "- Specs that amend this one by reference: 002 D5, D7, D8; 003 D7, D8; 004 D2, D9; 005 D3, D8; 007; 010",
        ],
    ),
    CC: dict(
        folder="012-claude-code-adapter",
        title="# 012 Claude Code adapter",
        sections=CC_SECTIONS,
        intro="The Claude Code plugin is the first implementation of the hook contract (011 C8) and the harness 001 proved its goals with. It serves 011's goals 1, 2 and 6 through Claude Code's hook events, and goal 3's labels reach the agent through its headers. Every rule that holds for every harness lives in 011 (C5, C8, C9, C10); this spec holds Claude Code's events, packaging and session mechanics: `hooks/hooks.json`, the entries and their budgets, the `asyncRewake` idle waiter and its `-p` guard, forked agents, `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_PROJECT_DIR`, the per-session root, SubagentStart's isolated `cwd`, the plugin's skills and `bin/`, the marketplace install through `squeal init`, the committed `dist/` and its drift check. Excluded: the content of a delta, header or primer fact (011); wording (005 D4, D6); `src/harness/shared/**` (011 C8); Codex, Pi and OpenCode (002, 009, 008); the test-command deny's rule (005 D8).",
        refs=[
            "- `../001-core-loop/research/claude-code-integration.md`, `uncovered-suites.md`, `uncovered-trust.md`, `primer-skill-writing.md`",
            "- ADR 0003 delivery model; 002 D5 (the shared hook code's move); 005 D3, D4, D6",
            "- Split proposal: `../001-core-loop/split-proposal.md`",
        ],
    ),
    V: dict(
        folder="013-vitest-runner",
        title="# 013 Vitest runner adapter",
        sections=V_SECTIONS,
        intro="The Vitest adapter implements `RunnerAdapter` (011 C14) over one warm `vitest/node` instance per worktree and lane. It decides what Vite's module graph says about a change, what a test file's closure and packages are, how a run is issued and read, which Vitest-specific inputs enter a key, and how the recorder and the child marker reach Vitest's workers. When a tier runs, what happens to its results, and what a key means are 011's (C3, C4, C11). Excluded: the recorder's own code and form rule (011 C12, C10); the install-detection rule (011 C11); node:test's and pytest's use of the same contracts (003, 007).",
        refs=[
            "- `../001-core-loop/research/vitest-internals.md`, `cezar-e2e-setup.md`, `revert-restore-pass.md`, `revert-restore-pass-2.md`; `per-package-keys.md` with 011 C11",
            "- ADR 0001 stack; 003 D7, D8 (the composite runner and the selection rule)",
            "- Split proposal: `../001-core-loop/split-proposal.md`",
        ],
    ),
}

# --------------------------------------------------------------- emission
by_section: dict[tuple[str, str], list[int]] = defaultdict(list)
for n, (spec, key) in MAP.items():
    by_section[(spec, key)].append(n)


def runs(nums: list[int], split_at_notes: bool = False) -> list[list[int]]:
    out: list[list[int]] = []
    for n in sorted(nums):
        if out and out[-1][-1] == n - 1 and not (split_at_notes and out[-1][-1] in NOTES):
            out[-1].append(n)
        else:
            out.append([n])
    return out


def tag(run: list[int]) -> str:
    span = f"{run[0]}" if len(run) == 1 else f"{run[0]}-{run[-1]}"
    return f"<!-- 001 spec.md@{SHA} lines {span} ({heading_of[run[0]]}) -->"


def emit_lines(spec: str, key: str) -> list[str]:
    out: list[str] = []
    for run in runs(by_section.get((spec, key), []), split_at_notes=True):
        out.append(tag(run))
        out.extend(lines[n - 1] for n in run)
        out.append("")
        for n in run:
            if n in NOTES:
                out.append(NOTES[n])
                out.append("")
    return out


def compress(nums: list[int]) -> str:
    return ", ".join(f"{r[0]}" if len(r) == 1 else f"{r[0]}-{r[-1]}" for r in runs(nums))


LABELS = {
    "problem": "Problem", "goals": "Goals", "nongoals": "Non-goals", "testing": "Testing",
    "open": "Open questions", "refs": "References",
}


def crosswalk(spec: str) -> list[str]:
    rows: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    for n, (s, key) in MAP.items():
        rows[heading_of[n]][f"{s} {LABELS.get(key, key)}"].append(n)
    out = ["| 001 section | Lines | Now in |", "|---|---|---|"]
    order = []
    for n in range(1, len(lines) + 1):
        h = heading_of[n]
        if h and h not in order:
            order.append(h)
    for h in order:
        if h not in rows:
            continue
        cells = []
        for target, nums in sorted(rows[h].items(), key=lambda kv: min(kv[1])):
            mark = "**" if target.startswith(spec) else ""
            cells.append(f"{mark}{target}{mark} ({compress(nums)})")
        all_nums = [n for nums in rows[h].values() for n in nums]
        out.append(f"| {h} | {compress(all_nums)} | {'; '.join(cells)} |")
    return out


def keyed(spec: str, key: str, title: str, intro: str | None = None) -> list[str]:
    body = emit_lines(spec, key)
    if not body and not intro:
        return []
    out = [title, ""]
    if intro:
        out += [intro, ""]
    return out + body


def build(spec: str) -> str:
    m = META[spec]
    out = [
        m["title"],
        "",
        f"Stage: shipped (inherited from 001, shipped 2026-10-06; this spec forked 2026-10-17). Source: `../001-core-loop/spec.md` at `{SHA}`, frozen; split per `../001-core-loop/split-proposal.md` (the human's decisions Q1 to Q8, 2026-10-16 and 2026-10-17). Every paragraph tagged with an HTML comment is 001's text verbatim; text under a **Note** or in a section 001 did not have is new. Amendments after the fork are dated lines in `status.md` here and edits to this file.",
        "",
        "## Scope",
        "",
        m["intro"],
        "",
    ]
    if spec == C:
        out += keyed(spec, "problem", "## Problem")
        out += keyed(spec, "goals", "## Goals")
        out += keyed(spec, "nongoals", "## Non-goals, as amended")
    elif spec == CC:
        out += keyed(spec, "nongoals", "## Non-goals")
    out += ["## Design", ""]
    for key, heading, intro, outro in m["sections"]:
        out += keyed(spec, key, heading, intro)
        if outro:
            out += [outro, ""]
    out += ["## Known seams", "", "Coupling recorded by the split proposal (section 3), not changed by it. Each is a candidate row, never an implied one.", ""]
    out += [f"- {s}" for s in SEAMS[spec]] + [""]
    out += keyed(spec, "testing", "## Testing")
    out += keyed(spec, "open", "## Open questions", "Numbering is 001's, so the lessons and reviews that cite a question keep resolving. Owner is the coordinator unless noted.")
    out += ["## References", ""] + m["refs"] + [""]
    out += emit_lines(spec, "refs")
    out += ["## Crosswalk from 001", "", f"Lines are those of `001-core-loop/spec.md` at `{SHA}`. Bold targets are this spec's; the others name where the rest of a 001 section went.", ""]
    out += crosswalk(spec) + [""]
    text = "\n".join(out)
    return re.sub(r"\n{3,}", "\n\n", text).rstrip("\n") + "\n"


outputs = {spec: build(spec) for spec in (C, CC, V)}

# ---------------------------------------------------------------- coverage
report = []
bad = 0
joined = {spec: outputs[spec].split("\n") for spec in outputs}
for n in content:
    text = lines[n - 1]
    hits = sum(ls.count(text) for ls in joined.values())
    if hits != 1:
        bad += 1
        report.append(f"line {n}: {hits} occurrences: {text[:80]}")
summary = f"001 spec.md@{SHA}: {len(content)} content lines routed; {len(content) - bad} appear exactly once across 011, 012, 013; {bad} do not."
report.insert(0, summary)
(HERE / "coverage.txt").write_text("\n".join(report) + "\n")
print(summary)
if bad:
    sys.exit(1)

NUMBER = {C: "011", CC: "012", V: "013"}
SHORT = {C: "Core", CC: "Claude Code adapter", V: "Vitest runner adapter"}
for spec, text in outputs.items():
    folder = SPECS / META[spec]["folder"]
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "spec.md").write_text(text)
    print(f"wrote {folder / 'spec.md'} ({len(text.splitlines())} lines)")
    for sub in ("tasks", "reviews", "research"):
        (folder / sub).mkdir(exist_ok=True)
    status = folder / "status.md"
    if not status.exists():
        status.write_text(f"""# {NUMBER[spec]} {SHORT[spec]}: status

Stage: shipped (inherited from 001, shipped 2026-10-06)
Started: 2026-10-17, forked from `../001-core-loop/spec.md` at `{SHA}` by the split proposal (`../001-core-loop/split-proposal.md`, section 6)

## Decisions so far

- 001's decisions through 0.1.203 stand; they are in `../001-core-loop/status.md` (frozen) with the amendment lines that made them. The crosswalk at the end of `spec.md` maps every 001 section to its section here.
- The split proposal's decisions by the human (Q1 to Q8, 2026-10-16 and 2026-10-17) bind this spec: see its sections 9 and 11.

## Amendment log

Every accepted deviation is a dated line here and an edit to the section of `spec.md` it changes (`docs/process.md`, step 6).

- 2026-10-17: forked from 001 at `{SHA}`. 001's text lifted verbatim (tagged paragraphs); the notes and the sections 001 did not have are new and change no rule.
""")
    (folder / "tasks" / "README.md").write_text(f"Task notes for {NUMBER[spec]} rows. 001's task notes stay in `../../001-core-loop/tasks/`, reachable by their row numbers.\n")
    (folder / "reviews" / "README.md").write_text(f"Reviews of {NUMBER[spec]} waves. 001's reviews stay in `../../001-core-loop/reviews/`.\n")
    research = ["# Research for spec " + NUMBER[spec], "", "Links only. The findings behind this spec were written for 001 and stay in `../../001-core-loop/research/`; a new topic gets a brief here and its findings file beside it.", ""]
    for name in RESEARCH[spec]:
        path = SPECS / "001-core-loop" / "research" / f"{name}.md"
        assert path.exists(), path
        research.append(f"- [{name}](../../001-core-loop/research/{name}.md)")
    (folder / "research" / "README.md").write_text("\n".join(research) + "\n")
