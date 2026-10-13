import { execFileSync } from "node:child_process";
import { POLICY_FILE } from "../../core/daemon/policy.js";
import { init } from "../init.js";
import type { CliIo } from "../main.js";
import { warmUp } from "../warmup.js";
import { initWithChoices, type SetupChoices } from "./apply.js";
import type { Asker } from "./ask.js";
import { formatPlan } from "./format.js";
import type { SetupPlan } from "./plan.js";
import {
  answerPlan,
  defaultPick,
  type GivenAnswers,
  listPick,
  type SetupAnswers,
  terminalPick,
} from "./questions.js";

/*
 * `squeal setup`, spec 005 D3 steps 3 to 5: ask, apply through `squeal init`
 * and its setup flags (gates before the block, as the gate ids are pre-edit
 * line numbers), Codex trust, the warm-up, then the diff. Never commits.
 */

export interface SetupRun {
  readonly plan: SetupPlan;
  readonly given: GivenAnswers;
  /** `--yes`: the defaults for every question not answered by a flag. */
  readonly yes: boolean;
  /** The terminal to ask on; `null` without one. */
  readonly asker: Asker | null;
}

/**
 * Exit 1 when no terminal and no `--yes` (nothing written) or a step failed;
 * else the warm-up's 0, 1 or 3, or 0 without one.
 */
export async function runSetup(run: SetupRun, io: CliIo): Promise<number> {
  const { plan } = run;
  io.stdout(formatPlan(plan));
  if (run.asker === null && !run.yes) {
    io.stdout("\nQuestions, the default first:\n");
    await answerPlan(plan, run.given, listPick(io.stdout));
    io.stderr(
      "\nsqueal setup: no terminal to ask on; rerun on a terminal, or with --yes to take the defaults (one flag per choice to change one); nothing changed\n",
    );
    return 1;
  }
  io.stdout("\n");
  const pick = run.yes ? defaultPick(io.stdout) : terminalPick(askOf(run.asker), io.stdout);
  let answers: SetupAnswers;
  try {
    answers = await answerPlan(plan, run.given, pick);
  } finally {
    run.asker?.close();
  }
  io.stdout("\n");
  let code = await apply(answers, io);
  if (code !== 0) return code;
  if (answers.trust) {
    if ((await init(["--harness", "codex", "--trust", "--yes"], io)) !== 0) {
      io.stderr(
        "squeal setup: Codex trust was not given; squeal init --harness codex --trust retries it\n",
      );
      code = 1;
    }
  }
  if (answers.warmup) {
    io.stdout("\n");
    const warm = await warmUp(plan.root, io);
    for (const c of warm.slowCandidates) {
      io.stdout(
        `squeal setup: ${c.path} ran ${Math.round(c.durationMs / 1000)} s; squeal setup --slow ${c.path} runs it in the slow tier\n`,
      );
    }
    if (code === 0) code = warm.code;
  }
  showChanges(plan, io);
  return code;
}

function askOf(asker: Asker | null): Asker["ask"] {
  if (asker === null) throw new Error("no terminal to ask on");
  return asker.ask;
}

/**
 * One `initWithChoices` per harness chosen, the first carrying every choice
 * but the other harnesses' blocks; each harness reads its own block file.
 */
async function apply(answers: SetupAnswers, io: CliIo): Promise<number> {
  const runs = Math.max(answers.harnesses.length, answers.blocks.length, 1);
  for (let i = 0; i < runs; i++) {
    const harness = answers.harnesses[i];
    const choices: SetupChoices =
      i === 0
        ? {
            block: answers.blocks[0] ?? null,
            gates: answers.gates,
            slow: answers.slow,
            inputs: answers.inputs,
          }
        : { block: answers.blocks[i] ?? null, gates: [], slow: [], inputs: [] };
    const code = await initWithChoices(choices, io, () =>
      harness === undefined ? 0 : init(["--harness", harness], io),
    );
    if (code !== 0) {
      io.stderr("squeal setup: stopped; what is listed above was written\n");
      return code;
    }
  }
  return 0;
}

/** D3 step 5: `git diff --stat`, the diff of every instruction file, and what to commit. */
function showChanges(plan: SetupPlan, io: CliIo): void {
  const git = (args: string[]) => {
    try {
      return execFileSync("git", ["-C", plan.root, ...args], { encoding: "utf8" });
    } catch {
      return "";
    }
  };
  const files = [...new Set(plan.instructions.flatMap((f) => [f.path, ...f.aliases]))];
  const stat = git(["diff", "--stat"]);
  const diff = files.length === 0 ? "" : git(["diff", "--", ...files]);
  const untracked = git(["status", "--porcelain", "--", POLICY_FILE, ".claude/settings.json"])
    .split("\n")
    .filter((line) => line.startsWith("??"))
    .map((line) => line.slice(3));
  const changed = git(["diff", "--name-only"])
    .split("\n")
    .filter((l) => l !== "");
  io.stdout(
    `\nChanges:\n${stat === "" ? "  none to tracked files\n" : stat}${diff === "" ? "" : `\n${diff}`}`,
  );
  const commit = [...changed, ...untracked];
  io.stdout(
    commit.length === 0
      ? "\nNothing to commit.\n"
      : `\nCommit these when they look right; squeal setup never commits:\n${commit.map((f) => `  ${f}\n`).join("")}${untracked.includes(POLICY_FILE) ? `Other worktrees read ${POLICY_FILE} only once it is committed.\n` : ""}`,
  );
}
