import { isAbsolute, join, normalize } from "node:path";
import { POLICY_FILE } from "../../core/daemon/policy.js";
import { findWorktreeRoot } from "../../core/fs/index.js";
import { globToRegExp } from "../../core/keys/glob.js";
import type { AbsolutePath } from "../../core/types/index.js";
import type { CliIo } from "../main.js";
import { blockText, resolved, unfindableBlock, withBlock, writeBlockFile } from "./block.js";
import { editConfig, readConfig, readOrEmpty } from "./config-edit.js";
import { addExcludes } from "./exclude.js";
import { rewordGates } from "./gates.js";
import { readPlan, type SetupPlan } from "./plan.js";
import { writePytestSeed } from "./pytest.js";
import { asDirectoryGlob, directoryIn, holdsTestFile, selectsAny } from "./test-globs.js";

/*
 * Spec 005 D3 step 4: `squeal init` gains one flag per setup choice, which
 * the setup command and skill pass: `--block <file|none>`, `--gate
 * <id>=<reword|keep>`, `--slow <glob>`, `--input <test glob>=<input glob>`,
 * and `--exclude <test glob>` (row 005-70: the runners' `exclude`). Without
 * them, init behaves as before. Row 005-40: a test glob must select a test
 * file, a bare directory is taken as `<dir>/**`, and `=none` is no input.
 */

export interface SetupChoices {
  /** A worktree-relative file, `none`, or `null` when not given. */
  readonly block: string | null;
  readonly gates: readonly { readonly id: string; readonly choice: "reword" | "keep" }[];
  readonly slow: readonly string[];
  readonly inputs: readonly { readonly test: string; readonly input: string }[];
  /** Worktree-relative test globs for each runner's `exclude`. */
  readonly exclude: readonly string[];
}

export const SETUP_FLAGS_USAGE = `       Setup choices, any harness: [--block <file|none>] [--gate <id>=<reword|keep>]...
         [--slow <glob>]... [--input <test glob>=<input glob|none>]... [--exclude <test glob>]...
`;

/** Takes the setup flags out of `args`; the rest is init's own. A string is a usage error. */
export function takeSetupFlags(
  args: readonly string[],
): { readonly choices: SetupChoices; readonly rest: string[] } | string {
  let block: string | null = null;
  const gates: { id: string; choice: "reword" | "keep" }[] = [];
  const slow: string[] = [];
  const inputs: { test: string; input: string }[] = [];
  const exclude: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const flag = ["--block", "--gate", "--slow", "--input", "--exclude"].find(
      (f) => arg === f || arg.startsWith(`${f}=`),
    );
    if (flag === undefined) {
      rest.push(arg);
      continue;
    }
    const value = arg === flag ? args[++i] : arg.slice(flag.length + 1);
    if (value === undefined || value === "") return `${flag} takes a value`;
    if (flag === "--block") {
      if (block !== null) return "--block is given once";
      block = value;
    } else if (flag === "--gate") {
      const at = value.lastIndexOf("=");
      const choice = value.slice(at + 1);
      if (at <= 0 || (choice !== "reword" && choice !== "keep")) {
        return `--gate takes <id>=reword or <id>=keep, not "${value}"`;
      }
      gates.push({ id: value.slice(0, at), choice });
    } else if (flag === "--slow") slow.push(value);
    else if (flag === "--exclude") exclude.push(value);
    else {
      const at = value.indexOf("=");
      if (at <= 0 || at === value.length - 1) {
        return `--input takes <test glob>=<input glob>, not "${value}"`;
      }
      inputs.push({ test: value.slice(0, at), input: value.slice(at + 1) });
    }
  }
  return { choices: { block, gates, slow, inputs, exclude }, rest };
}

export function hasChoices(choices: SetupChoices): boolean {
  return (
    choices.block !== null ||
    choices.gates.length > 0 ||
    choices.slow.length > 0 ||
    choices.inputs.length > 0 ||
    choices.exclude.length > 0
  );
}

/**
 * Row 005-40: the `--slow`, `--input` and `--exclude` globs as they apply,
 * each bare directory as `<dir>/**` and each `--input <glob>=none` left out,
 * with a line saying so; a string names a test glob that selects none of `testFiles`.
 */
export function normalizeGlobs(
  root: string,
  given: Pick<SetupChoices, "slow" | "inputs" | "exclude">,
  testFiles: readonly string[],
):
  | (Pick<SetupChoices, "slow" | "inputs" | "exclude"> & { readonly lines: readonly string[] })
  | string {
  const lines: string[] = [];
  const as = (glob: string, isDirectory: (dir: string) => boolean) => {
    const taken = asDirectoryGlob(glob, isDirectory);
    if (taken !== glob) lines.push(`took ${glob} as ${taken}`);
    return taken;
  };
  const testGlob = (glob: string) => {
    const taken = as(glob, holdsTestFile(testFiles));
    return selectsAny(taken, testFiles) ? taken : null;
  };
  const slow: string[] = [];
  for (const glob of given.slow) {
    const taken = testGlob(glob);
    if (taken === null) return `--slow ${glob} selects no test file`;
    slow.push(taken);
  }
  const inputs: { test: string; input: string }[] = [];
  for (const { test, input } of given.inputs) {
    const taken = testGlob(test);
    if (taken === null) return `--input ${test}=${input}: ${test} selects no test file`;
    if (input === "none") lines.push(`no input for ${taken}`);
    else inputs.push({ test: taken, input: as(input, directoryIn(root)) });
  }
  const exclude: string[] = [];
  for (const glob of given.exclude) {
    const taken = testGlob(glob);
    if (taken === null) return `--exclude ${glob} selects no test file`;
    exclude.push(taken);
  }
  return { slow, inputs, exclude, lines: [...new Set(lines)] };
}

/**
 * Spec 005 D3 step 4: the choices are checked before anything is written,
 * `harness` sets the harness up as `squeal init` does without them, then
 * the choices apply. A choice that cannot apply changes nothing (exit 1); a
 * harness step that fails leaves the choices unapplied.
 */
export async function initWithChoices(
  choices: SetupChoices,
  io: CliIo,
  harness: () => number | Promise<number>,
): Promise<number> {
  const cwd = io.cwd ?? process.cwd();
  const root = findWorktreeRoot(cwd);
  if (root === null) {
    io.stderr(`squeal init: ${cwd} is not inside a git worktree\n`);
    return 1;
  }
  const checked = await checkChoices(root, choices, io.env ?? process.env);
  if (typeof checked === "string") {
    io.stderr(`squeal init: ${checked}; nothing changed\n`);
    return 1;
  }
  for (const line of checked.lines) io.stdout(`squeal init: ${line}\n`);
  const code = await harness();
  if (code !== 0) {
    io.stderr("squeal init: the setup choices were not applied\n");
    return code;
  }
  try {
    for (const line of applyChoices(root, checked)) {
      io.stdout(`squeal init: ${line}\n`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.stderr(`squeal init: could not apply the setup choices: ${reason}\n`);
    return 1;
  }
  return 0;
}

/** Why the choices cannot be applied to this worktree, read before anything is written; `null` when they can. */
async function checkChoices(
  root: AbsolutePath,
  choices: SetupChoices,
  env: Readonly<Record<string, string | undefined>>,
): Promise<
  | {
      readonly plan: SetupPlan;
      readonly testFiles: readonly string[];
      readonly choices: SetupChoices;
      readonly lines: readonly string[];
    }
  | string
> {
  const { plan, testFiles } = await readPlan(root, { env });
  for (const { id, choice } of choices.gates) {
    const gate = plan.gates.find((g) => g.id === id);
    if (gate === undefined) return `no gate line ${id}; squeal setup --plan lists them`;
    if (choice === "reword" && gate.proposed === null) {
      return `${id}: ${gate.reason}; reword it by hand`;
    }
  }
  if (choices.block !== null && choices.block !== "none") {
    const path = choices.block;
    if (isAbsolute(path) || normalize(path).startsWith("..")) {
      return `--block takes a file inside the worktree, not "${path}"`;
    }
    const unfindable = await unfindableBlock(root, path);
    if (unfindable !== null) return unfindable;
    const text = readOrEmpty(resolved(root, path));
    const written = withBlock(text, blockText());
    if (typeof written !== "string") {
      return `${path}:${written.unterminated}: a Squeal block begins with no end; fix it by hand`;
    }
  }
  for (const glob of [
    ...choices.slow,
    ...choices.inputs.flatMap((i) => [i.test, i.input]),
    ...choices.exclude,
  ]) {
    try {
      globToRegExp(glob);
    } catch (error) {
      return error instanceof Error ? error.message.replace(/^squeal: /, "") : String(error);
    }
  }
  const globs = normalizeGlobs(root, choices, testFiles);
  if (typeof globs === "string") return globs;
  const config = readConfig(root);
  if (
    globs.slow.length + globs.inputs.length + globs.exclude.length > 0 &&
    config === null &&
    readOrEmpty(join(root, POLICY_FILE)) !== ""
  ) {
    return `${POLICY_FILE} is not a JSON object; fix it first`;
  }
  if (globs.inputs.length > 0 && Array.isArray(config?.inputs)) {
    return `inputs in ${POLICY_FILE} is a list applied to every test file; add these by hand`;
  }
  return {
    plan,
    testFiles,
    choices: { ...choices, slow: globs.slow, inputs: globs.inputs, exclude: globs.exclude },
    lines: globs.lines,
  };
}

/** Applies checked choices; the lines say what changed. Throws only on a failed write. */
function applyChoices(
  root: AbsolutePath,
  {
    choices,
    plan,
    testFiles,
  }: { choices: SetupChoices; plan: SetupPlan; testFiles: readonly string[] },
): string[] {
  const lines: string[] = [];
  const reword = choices.gates.filter((g) => g.choice === "reword").map((g) => g.id);
  if (reword.length > 0) {
    const tracked = plan.gates.map((g) => g.file);
    const result = rewordGates(root, [...new Set(tracked)], reword, {
      nodeTest: plan.runners.nodeTest.length > 0,
    });
    if ("refused" in result) throw new Error(result.refused);
    lines.push(...result.written.map((id) => `reworded gate line ${id}`));
  }
  for (const { id } of choices.gates.filter((g) => g.choice === "keep")) {
    lines.push(`kept gate line ${id}`);
  }
  if (choices.block !== null && choices.block !== "none") {
    const runners = {
      vitest: plan.runners.vitest,
      nodeTest: plan.runners.nodeTest.length > 0,
      pytest: (plan.runners.pytest?.length ?? 0) > 0,
    };
    const edit = writeBlockFile(root, choices.block, blockText(runners));
    lines.push(
      edit.result === "unchanged"
        ? `the Squeal block in ${choices.block} is current`
        : `wrote the Squeal block to ${choices.block}`,
    );
  } else if (choices.block === "none") lines.push("wrote no Squeal block");
  if (choices.slow.length + choices.inputs.length + choices.exclude.length > 0)
    lines.push(
      ...editConfig(root, choices, (config) =>
        addExcludes(config, plan, testFiles, choices.exclude),
      ),
    );
  lines.push(...writePytestSeed(root, plan));
  return lines;
}
