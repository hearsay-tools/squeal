import { findWorktreeRoot } from "../../core/fs/index.js";
import type { CliIo } from "../main.js";
import { normalizeGlobs, takeSetupFlags } from "./apply.js";
import { type Asker, terminalAsker } from "./ask.js";
import { runSetup } from "./flow.js";
import { formatPlan } from "./format.js";
import type { HarnessId } from "./harnesses.js";
import { readPlan } from "./plan.js";
import type { GivenAnswers } from "./questions.js";

export const SETUP_USAGE = `Usage: squeal setup [--yes] [--harness <claude-code|codex|none>]... [--block <file|none>]...
         [--gate <id>=<reword|keep>]... [--slow <glob|none>]... [--input <test glob>=<input glob|none>]...
         [--no-trust] [--no-warmup]
       squeal setup --plan [--json]
       squeal setup --check [--json]
`;

export interface SetupDeps {
  /** The terminal to ask on; default `terminalAsker()`, `null` when stdin or stdout is not a TTY. */
  readonly asker?: () => Asker | null;
}

/**
 * `squeal setup --plan [--json]` prints the plan and exits 0; `--check`
 * prints it too and exits 1 when anything is outdated (spec 005 D3). Both
 * write nothing. Bare `squeal setup` asks one question per open choice on a
 * terminal, or takes the defaults with `--yes`, and applies them
 * (`runSetup`). Exit 1 outside a git worktree, 2 on a usage error.
 */
export async function setupCommand(
  args: readonly string[],
  io: CliIo,
  deps: SetupDeps = {},
): Promise<number> {
  const parsed = parseSetupArgs(args);
  if (typeof parsed === "string") {
    io.stderr(`squeal setup: ${parsed}\n\n${SETUP_USAGE}`);
    return 2;
  }
  const cwd = io.cwd ?? process.cwd();
  const root = findWorktreeRoot(cwd);
  if (root === null) {
    io.stderr(`squeal setup: ${cwd} is not inside a git worktree\n`);
    return 1;
  }
  const env = io.env ?? process.env;
  const { plan, testFiles } = await readPlan(root, { env, codexTrust: true });
  if (parsed.mode === "apply") {
    // Row 005-40: a test glob that selects nothing is refused before any question.
    let { given } = parsed;
    if (given.slow !== null) {
      const globs = normalizeGlobs(root, given.slow, testFiles);
      if (typeof globs === "string") {
        io.stderr(`squeal setup: ${globs}; nothing changed\n`);
        return 1;
      }
      for (const line of globs.lines) io.stdout(`squeal setup: ${line}\n`);
      given = { ...given, slow: { slow: globs.slow, inputs: globs.inputs } };
    }
    const asker = parsed.yes ? null : (deps.asker ?? terminalAsker)();
    return runSetup({ plan, given, yes: parsed.yes, asker }, io);
  }
  io.stdout(parsed.json ? `${JSON.stringify(plan, null, 2)}\n` : formatPlan(plan));
  return parsed.mode === "check" && plan.outdated.length > 0 ? 1 : 0;
}

type SetupArgs =
  | { readonly mode: "plan" | "check"; readonly json: boolean }
  | { readonly mode: "apply"; readonly yes: boolean; readonly given: GivenAnswers };

function parseSetupArgs(args: readonly string[]): SetupArgs | string {
  const flags = new Set(args);
  if (flags.has("--plan") || flags.has("--check")) {
    const unknown = args.find((arg) => !["--plan", "--check", "--json"].includes(arg));
    if (unknown !== undefined) return `unknown argument "${unknown}"`;
    if (flags.has("--plan") && flags.has("--check")) return "takes --plan or --check, not both";
    return { mode: flags.has("--check") ? "check" : "plan", json: flags.has("--json") };
  }
  // `--block` may be given once per instruction file here; init takes it once.
  const blocks: string[] = [];
  const harnesses: (HarnessId | "none")[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const flag = ["--block", "--harness"].find((f) => arg === f || arg.startsWith(`${f}=`));
    if (flag === undefined) {
      rest.push(arg);
      continue;
    }
    const value = arg === flag ? args[++i] : arg.slice(flag.length + 1);
    if (value === undefined || value === "") return `${flag} takes a value`;
    if (flag === "--block") blocks.push(value);
    else if (value === "claude-code" || value === "codex" || value === "none")
      harnesses.push(value);
    else return `--harness takes claude-code, codex or none, not "${value}"`;
  }
  const setup = takeSetupFlags(rest);
  if (typeof setup === "string") return setup;
  const own = ["--yes", "--no-trust", "--no-warmup", "--json"];
  const unknown = setup.rest.find((arg) => !own.includes(arg));
  if (unknown !== undefined) return `unknown argument "${unknown}"`;
  if (setup.rest.includes("--json")) return "--json goes with --plan or --check";
  if (blocks.includes("none") && blocks.length > 1) return "--block none goes alone";
  // `--harness none` answers "no" to every harness, which leaving the flag out cannot say.
  const noHarness = harnesses.includes("none");
  if (noHarness && harnesses.length > 1) return "--harness none goes alone";
  const { gates, inputs } = setup.choices;
  // `--slow none` answers every slow group "not slow", which no glob can say.
  const noSlow = setup.choices.slow.includes("none");
  if (noSlow && setup.choices.slow.length + inputs.length > 1) return "--slow none goes alone";
  const slow = noSlow ? [] : setup.choices.slow;
  return {
    mode: "apply",
    yes: setup.rest.includes("--yes"),
    given: {
      harnesses: harnesses.length > 0 ? harnesses.filter((h) => h !== "none") : null,
      blocks: blocks.length > 0 ? blocks : null,
      gates,
      slow: noSlow || slow.length + inputs.length > 0 ? { slow, inputs } : null,
      trust: setup.rest.includes("--no-trust") ? false : null,
      warmup: setup.rest.includes("--no-warmup") ? false : null,
    },
  };
}
