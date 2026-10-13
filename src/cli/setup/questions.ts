import type { Ask } from "./ask.js";
import type { HarnessId } from "./harnesses.js";
import type { SetupPlan, SlowGroup } from "./plan.js";

/*
 * Spec 005 D3 step 3: one question per open choice of the plan, the plan's
 * default first. A choice given as a flag is not asked. Later questions
 * follow earlier answers: the block is asked for the harnesses chosen.
 */

export interface Question {
  readonly text: string;
  /** The default first. */
  readonly choices: readonly string[];
}

/** Chooses one of a question's choices, by index. */
export type Choose = (question: Question) => Promise<number>;

export interface SetupAnswers {
  readonly harnesses: readonly HarnessId[];
  /** Instruction files to write the block to, one per harness at most. */
  readonly blocks: readonly string[];
  readonly gates: readonly { readonly id: string; readonly choice: "reword" | "keep" }[];
  readonly slow: readonly string[];
  readonly inputs: readonly { readonly test: string; readonly input: string }[];
  readonly trust: boolean;
  readonly warmup: boolean;
}

/** Answers given as flags; `null` where none was given, so the question is asked. */
export interface GivenAnswers {
  readonly harnesses: readonly HarnessId[] | null;
  readonly blocks: readonly string[] | null;
  readonly gates: readonly { readonly id: string; readonly choice: "reword" | "keep" }[];
  /** `--slow` and `--input` answer every slow group's questions together. */
  readonly slow: Pick<SetupAnswers, "slow" | "inputs"> | null;
  readonly trust: boolean | null;
  readonly warmup: boolean | null;
}

export const NO_ANSWERS: GivenAnswers = {
  harnesses: null,
  blocks: null,
  gates: [],
  slow: null,
  trust: null,
  warmup: null,
};

const HARNESS_NAMES: Record<HarnessId, string> = { "claude-code": "Claude Code", codex: "Codex" };

export async function answerPlan(
  plan: SetupPlan,
  given: GivenAnswers,
  pick: Choose,
): Promise<SetupAnswers> {
  const yes = async (text: string, byDefault: boolean, yesText = "yes", noText = "no") => {
    const choices = byDefault ? [yesText, noText] : [noText, yesText];
    return (await pick({ text, choices })) === (byDefault ? 0 : 1);
  };

  const harnesses: HarnessId[] = [];
  for (const h of plan.harnesses) {
    if (given.harnesses !== null) {
      if (given.harnesses.includes(h.id)) harnesses.push(h.id);
      continue;
    }
    const found = h.onPath || h.plugin !== null;
    const where = `${h.onPath ? "on the PATH" : "not on the PATH"}, ${h.plugin === null ? "plugin not installed" : `plugin ${h.plugin.version}`}`;
    if (await yes(`Set up ${HARNESS_NAMES[h.id]} here (${where})?`, found)) harnesses.push(h.id);
  }

  const blocks: string[] = [];
  if (given.blocks !== null) blocks.push(...given.blocks.filter((b) => b !== "none"));
  else {
    for (const file of plan.instructions) {
      const readers = file.harnesses.filter((h) => harnesses.includes(h));
      if (readers.length === 0) continue;
      const by = readers.map((h) => HARNESS_NAMES[h]).join(" and ");
      const { block } = file;
      if (block.state === "current" || block.state === "unterminated") continue;
      const write =
        block.state === "outdated"
          ? await yes(
              `${file.path} (read by ${by}) holds the Squeal block v${block.version}, which is outdated. Upgrade it?`,
              true,
              "upgrade it",
              `keep v${block.version}`,
            )
          : await yes(
              `Write the Squeal block to ${file.path} (read by ${by}${file.exists ? "" : "; it does not exist yet"})?`,
              true,
              "write it",
              "no block",
            );
      if (write) blocks.push(file.path);
    }
  }

  const gates = [...given.gates];
  for (const gate of plan.gates) {
    if (gate.proposed === null || gates.some((g) => g.id === gate.id)) continue;
    const reword = await yes(
      `Gate line ${gate.id}:\n    ${gate.text.trim()}\n  reworded:\n    ${gate.proposed.trim()}\n  Reword it?`,
      true,
      "reword",
      "keep",
    );
    gates.push({ id: gate.id, choice: reword ? "reword" : "keep" });
  }

  const slow: string[] = [...(given.slow?.slow ?? [])];
  const inputs: { test: string; input: string }[] = [...(given.slow?.inputs ?? [])];
  if (given.slow === null) {
    for (const group of plan.slow.groups) {
      const glob = groupGlob(group);
      const isSlow =
        group.declaredSlow ||
        (await yes(
          `${glob} (${group.files.length} files: ${group.reasons.join("; ")}). Run these tests in the slow tier?`,
          group.defaultSlow,
          "slow",
          "not slow",
        ));
      if (!group.declaredSlow && isSlow) slow.push(glob);
      if (!isSlow || group.inputsHoldArtifact || group.artifacts.length === 0) continue;
      const input = await inputQuestion(group, pick);
      if (input !== null) inputs.push(...input.map((dir) => ({ test: glob, input: `${dir}/**` })));
    }
  }

  const trust =
    given.trust ??
    (harnesses.includes("codex") && plan.codexTrust.state === "untrusted"
      ? await yes(
          `Codex has not trusted ${plan.codexTrust.untrusted} of the plugin's ${plan.codexTrust.hooks} hooks, and skips them silently. Have Codex trust them (once per user)?`,
          true,
        )
      : false);

  const { testFiles } = plan.warmup;
  const warmup =
    given.warmup ??
    (await yes(
      `Warm up now: run all ${testFiles} test files on this terminal's daemon, current ones too, to record the ignored paths each reads?`,
      true,
    ));

  return { harnesses, blocks, gates, slow, inputs, trust, warmup };
}

/** The glob a slow group's files go under, as `slow.include` and `inputs` take it. */
export function groupGlob(group: SlowGroup): string {
  return group.dir === "" ? "**" : `${group.dir}/**`;
}

/**
 * D3 "Slow tests and their inputs" step 3: the broader directory first, or
 * every candidate when none lies over the rest (siblings), then each one
 * alone, then none. `null` for none.
 */
async function inputQuestion(group: SlowGroup, pick: Choose): Promise<string[] | null> {
  const paths = group.artifacts.map((a) => a.path);
  const first = group.broader === null ? paths : [group.broader];
  const options = [
    first,
    ...paths.filter((p) => !first.includes(p) || first.length > 1).map((p) => [p]),
  ];
  const evidence = group.artifacts.map(
    (a) =>
      `    ${a.path}: ${a.evidence.map((e) => `${e.detail}${e.weak ? " (weak)" : ""}`).join("; ")}`,
  );
  const text = [
    `${groupGlob(group)} may test these artifacts, which Squeal does not see change:`,
    ...evidence,
    "  With an input, each rebuild re-runs the group and its results can be shared across worktrees;",
    "  without one, the group stays current after a rebuild until its own files change, and every",
    "  worktree runs it itself. Squeal never builds: keeping the artifact built stays your job.",
    "  Re-run these tests when this changes?",
  ].join("\n");
  const choices = [...options.map((dirs) => dirs.map((d) => `${d}/**`).join(" and ")), "none"];
  const index = await pick({ text, choices });
  return options[index] ?? null;
}

/** Asks on the terminal, printing the choices numbered; an empty or unreadable answer takes the default. */
export function terminalPick(ask: Ask, out: (text: string) => void): Choose {
  return async ({ text, choices }) => {
    out(numbered({ text, choices }));
    for (let tries = 0; tries < 3; tries++) {
      const answer = (await ask(`Choice [1]: `)).trim();
      if (answer === "") return 0;
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= choices.length) return n - 1;
      const named = choices.findIndex((c) => c.toLowerCase() === answer.toLowerCase());
      if (named !== -1) return named;
      out(`Answer 1 to ${choices.length}, or press Enter for 1.\n`);
    }
    return 0;
  };
}

/** `--yes`: the default, said. */
export function defaultPick(out: (text: string) => void): Choose {
  return async ({ text, choices }) => {
    out(`${text}\n  ${choices[0]} (default, --yes)\n`);
    return 0;
  };
}

/** No terminal and no `--yes`: lists each question with its choices and takes nothing. */
export function listPick(out: (text: string) => void): Choose {
  return async ({ text, choices }) => {
    out(numbered({ text, choices }));
    return 0;
  };
}

function numbered({ text, choices }: Question): string {
  return `\n${text}\n${choices.map((c, i) => `  ${i + 1}. ${c}${i === 0 ? " (default)" : ""}\n`).join("")}`;
}
