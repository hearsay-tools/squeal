import { findWorktreeRoot } from "../../core/fs/index.js";
import type { CliIo } from "../main.js";
import { formatPlan } from "./format.js";
import { buildPlan } from "./plan.js";

export const SETUP_USAGE = `Usage: squeal setup --plan [--json]
       squeal setup --check [--json]
Apply its choices with squeal init --block <file|none>, --gate <id>=<reword|keep>,
--slow <glob> and --input <test glob>=<input glob>.
`;

/**
 * `squeal setup --plan [--json]` prints the plan and exits 0; `--check`
 * prints it too and exits 1 when anything is outdated (spec 005 D3). Both
 * write nothing. Exit 1 outside a git worktree, 2 on a usage error.
 */
export async function setupCommand(args: readonly string[], io: CliIo): Promise<number> {
  const flags = new Set(args);
  const known = new Set(["--plan", "--check", "--json"]);
  const unknown = args.find((arg) => !known.has(arg));
  if (unknown !== undefined || (!flags.has("--plan") && !flags.has("--check"))) {
    const problem =
      unknown === undefined ? "takes --plan or --check" : `unknown argument "${unknown}"`;
    io.stderr(`squeal setup: ${problem}\n\n${SETUP_USAGE}`);
    return 2;
  }
  const cwd = io.cwd ?? process.cwd();
  const root = findWorktreeRoot(cwd);
  if (root === null) {
    io.stderr(`squeal setup: ${cwd} is not inside a git worktree\n`);
    return 1;
  }
  const plan = await buildPlan(root, { env: io.env ?? process.env });
  io.stdout(flags.has("--json") ? `${JSON.stringify(plan, null, 2)}\n` : formatPlan(plan));
  return flags.has("--check") && plan.outdated.length > 0 ? 1 : 0;
}
