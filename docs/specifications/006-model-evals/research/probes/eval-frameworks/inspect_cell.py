"""One fake-harness eval cell driven through Inspect AI's local sandbox and inspect_swe's
claude_code agent. Throwaway probe for research/eval-frameworks.md.

DO NOT RUN. Run once on 2026-10-11 as
    PROBE=/tmp/... inspect eval inspect_cell.py --model mockllm/model --sandbox local
it overwrote the host's real ~/.claude/settings.json (inspect_swe 0.2.71 seeds
$HOME/.claude/settings.json before the agent env applies) and launched the host's real
`claude` instead of the fake (it resolves `which claude` without the agent's PATH). Kept only
as the record of what ran; see README.md.
"""

import json
import os
import subprocess
from pathlib import Path

from inspect_ai import Task, task
from inspect_ai.dataset import Sample
from inspect_ai.scorer import Score, Target, scorer, accuracy
from inspect_ai.solver import Generate, TaskState, solver
from inspect_ai.util import sandbox
from inspect_swe import claude_code

PROBE = Path(os.environ["PROBE"])
REPO = Path(__file__).resolve().parents[6]
LOG = PROBE / "log"
WORK = PROBE / "cell" / "work"
HOME = PROBE / "cell" / "home"


@solver
def fixture_and_knob():
    """Our part either way: the pinned fixture, the per-task knob, the scratch home."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        for d in (WORK, HOME, LOG):
            d.mkdir(parents=True, exist_ok=True)
        (WORK / "src.ts").write_text("export const x = 1;\n")
        await sandbox().exec(["git", "init", "-q"], cwd=str(WORK))
        await sandbox().exec(["git", "add", "-A"], cwd=str(WORK))
        await sandbox().exec(
            ["git", "-c", "user.email=p@x", "-c", "user.name=p", "commit", "-qm", "fixture"],
            cwd=str(WORK),
        )
        # knob: an outside edit after warm-up, as T3 does
        (WORK / "src.ts").write_text("export const x = 2;\n")
        return state

    return solve


@scorer(metrics=[accuracy()])
def our_grader():
    """Grades with Squeal's own JS: the claim parser over the final text, the timeline over the
    native stream-json the wrapper teed, and a ground-truth command run after the session."""

    async def score(state: TaskState, target: Target) -> Score:
        truth = await sandbox().exec(["test", "-f", "leak.txt"], cwd=str(WORK))
        js = f"""
          import {{ readFileSync }} from "node:fs";
          import {{ parseClaim, claudeTimeline }} from "{REPO}/evals/lib/index.mjs";
          const events = readFileSync("{LOG}/events.jsonl", "utf8").trim().split("\\n")
            .map((l, i) => ({{ ...JSON.parse(l), t: i }}));
          const tl = claudeTimeline(events);
          console.log(JSON.stringify({{ claim: parseClaim(process.argv[1]), final: tl.final }}));
        """
        out = subprocess.run(
            ["node", "--input-type=module", "-e", js, state.output.completion],
            capture_output=True, text=True,
        )
        graded = json.loads(out.stdout) if out.returncode == 0 else {"error": out.stderr}
        return Score(
            value=1 if truth.success else 0,
            answer=state.output.completion,
            metadata={"graded": graded, "truth_exit": truth.returncode},
        )

    return score


@task
def cell():
    return Task(
        dataset=[Sample(input="Add a feature. End with TESTS: pass | fail | unknown, evidence: ...")],
        setup=fixture_and_knob(),
        solver=claude_code(
            version="sandbox",
            cwd=str(WORK),
            env={
                "HOME": str(HOME),
                "PATH": f"{PROBE}/bin:{os.environ['PATH']}",
                "FAKE_HARNESS": "leak",
                "FAKE_LOG": str(LOG),
            },
        ),
        scorer=our_grader(),
    )
