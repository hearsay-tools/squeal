import type { Ask } from "./ask.js";
import { excludeKeys } from "./exclude.js";
import type { HarnessId } from "./harnesses.js";
import type { ExcludeProposal, SetupPlan, SlowGroup } from "./plan.js";

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
  /** Row 005-70: the groups answered yes to "leave these tests to CI", as `--exclude` globs. */
  readonly exclude: readonly string[];
  readonly trust: boolean;
  readonly warmup: boolean;
}

/** Answers given as flags; `null` where none was given, so the question is asked. */
export interface GivenAnswers {
  readonly harnesses: readonly HarnessId[] | null;
  readonly blocks: readonly string[] | null;
  readonly gates: readonly { readonly id: string; readonly choice: "reword" | "keep" }[];
  /** `--slow`, `--input` and `--exclude` answer every slow group's questions together. */
  readonly slow: Pick<SetupAnswers, "slow" | "inputs" | "exclude"> | null;
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

  // D5: a gate line is written only on its own yes, so keep is the default and
  // `--yes` rewords none (005-59: a false proposal written unseen).
  const gates = [...given.gates];
  for (const gate of plan.gates) {
    if (gate.proposed === null || gates.some((g) => g.id === gate.id)) continue;
    const reword = await yes(
      `Gate line ${gate.id}:\n    ${gate.text.trim()}\n  reworded:\n    ${gate.proposed.trim()}\n  Reword it?`,
      false,
      "reword",
      "keep",
    );
    gates.push({ id: gate.id, choice: reword ? "reword" : "keep" });
  }

  const slow: string[] = [...(given.slow?.slow ?? [])];
  const inputs: { test: string; input: string }[] = [...(given.slow?.inputs ?? [])];
  const exclude: string[] = [...(given.slow?.exclude ?? [])];
  if (given.slow === null) {
    for (const group of plan.slow.groups) {
      const glob = groupGlob(group);
      // Row 005-70: an exclude candidate is asked first, yes by default; no keeps it a slow candidate.
      // B1: a yes excludes only the files that name a build output; the rest are asked about as slow.
      let left = group.files.length;
      if (
        !group.declaredSlow &&
        group.exclude != null &&
        (await yes(excludeQuestion(group, group.exclude), true, "exclude", "keep"))
      ) {
        exclude.push(...group.exclude.globs);
        left = group.exclude.kept.length;
        if (left === 0) continue;
      }
      const isSlow =
        group.declaredSlow ||
        (await yes(
          `${glob} (${left} ${left === group.files.length ? "" : "other "}files: ${group.reasons.join("; ")}). Run these tests in the slow tier?`,
          group.defaultSlow,
          "slow",
          "not slow",
        ));
      if (!group.declaredSlow && isSlow) slow.push(glob);
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

  return { harnesses, blocks, gates, slow, inputs, exclude, trust, warmup };
}

/**
 * D3 step 3: the evidence, the reason (Squeal never builds, so a result
 * against a build it cannot see is tied to no code state, vision principle
 * 2) and where a yes writes the glob.
 */
function excludeQuestion(group: SlowGroup, proposal: ExcludeProposal): string {
  const outputs = (group.buildOutputs ?? []).map((o) => {
    const evidence = o.evidence.map((e) => e.detail).join("; ");
    return `    ${o.path}${o.exists ? "" : " (not built here)"}: ${evidence}\n`;
  });
  const what = outputs.length === 1 ? "a build output" : "build outputs";
  const { kept } = proposal;
  const inputs =
    group.declaredInputs.length === 0 || kept.length > 0 ? "" : "; their inputs entries go too";
  if (kept.length === 0) {
    return [
      `${proposal.globs.join(", ")} (${group.files.length} files) tests ${what} Squeal does not produce:\n`,
      ...outputs,
      "Squeal never builds, so a result against a build it cannot see is tied to no code state. ",
      "No keeps them a slow candidate. Leave these tests to CI and to runs after a build ",
      `(${excludeKeys(proposal)}${inputs})?`,
    ].join("");
  }
  const named = group.files.length - kept.length;
  return [
    `${groupGlob(group)} (${group.files.length} files): ${named} ${named === 1 ? "tests" : "test"} ${what} Squeal does not produce:\n`,
    ...outputs,
    `  ${named === 1 ? "It" : "They"}, as --exclude takes ${named === 1 ? "it" : "them"}:\n`,
    ...proposal.globs.map((g) => `    ${g}\n`),
    "Squeal never builds, so a result against a build it cannot see is tied to no code state. ",
    `The ${kept.length} other${kept.length === 1 ? "" : "s"} name no build output and stay slow candidates; no keeps all ${group.files.length}. `,
    `Leave the ${named} to CI and to runs after a build (${excludeKeys(proposal)})?`,
  ].join("");
}

/** The glob a slow group's files go under, as `slow.include` and `inputs` take it. */
export function groupGlob(group: SlowGroup): string {
  return group.dir === "" ? "**" : `${group.dir}/**`;
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
