import type { NodeTestProject, TestFileRef } from "../../core/types/index.js";
import type { CoveredProject, Listing, RunnerDescription } from "../descriptions.js";

/** A configured `nodeTest` project's own command, recognized by 005 D8 step 1. */
export interface NodeTestCommand {
  readonly runner: "node-test";
  /** The `nodeTest` project whose own command it is. */
  readonly project: string;
  /** The test files it was narrowed to, as written; `null` runs the project's every file. */
  readonly files: readonly string[] | null;
}

/** What the primer says of node:test (task 001-234). */
export interface NodeTestCoverage {
  /** Each `nodeTest` project: its name and its include globs, relative to the root. */
  readonly nodeTest: readonly CoveredProject[];
}

/** What recognizing a node:test command reads besides the command: the policy's projects. */
export interface NodeTestContext {
  readonly nodeTest: readonly NodeTestProject[];
}

/** No `nodeTest` project: what `PRIMER` says. */
const UNCONFIGURED: NodeTestCoverage = { nodeTest: [] };

/**
 * node:test as the harness knows it (spec 016 D5): built for its
 * configured projects, which the primer names with their globs (spec 007
 * D8), and whose own commands are recognized from the worktree root only.
 */
export const NODE_TEST = {
  runner: "node-test",
  name: "node:test",
  fallback: false,
  unconfigured: UNCONFIGURED,
  projects: (policy) => policy.nodeTest,
  coverage: ({ projects }): NodeTestCoverage => ({ nodeTest: projects }),
  built: (coverage) => coverage.nodeTest.length > 0,
  covered: (coverage) => ({ projects: coverage.nodeTest }),
  excluded: () => null,
  context: (policy, _root, _cwd): NodeTestContext => ({ nodeTest: policy.nodeTest }),
  command: (words, context) =>
    context.atRoot === false ? null : nodeTestCommand(words, context.nodeTest),
  resolves: () => true,
  files: (command, listing) =>
    command.runner === "node-test" ? nodeTestFiles(command, listing) : null,
  slowProjects: (policy) => policy.nodeTest,
} satisfies RunnerDescription;

/**
 * A configured `nodeTest` project's own command, `<node> <argv...> --test
 * <include...>` run from the worktree root with no `env` of its own, or the
 * same with the globs replaced by literal test-file paths.
 */
function nodeTestCommand(
  words: readonly string[],
  projects: readonly NodeTestProject[],
): NodeTestCommand | null {
  const at = words.indexOf("--test");
  if (at === -1) return null;
  const argv = words.slice(1, at);
  const args = words.slice(at + 1);
  if (args.length === 0) return null;
  const project = projects.find(
    (p) =>
      (p.node ?? "node") === words[0] &&
      (p.cwd === undefined || p.cwd === "." || p.cwd === "") &&
      Object.keys(p.env).length === 0 &&
      same(p.argv, argv),
  );
  if (project === undefined) return null;
  if (same(project.include, args))
    return { runner: "node-test", project: project.name, files: null };
  if (args.some((arg) => arg.startsWith("-") || /[*?[\]{}]/.test(arg))) return null;
  return { runner: "node-test", project: project.name, files: args };
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((word, i) => word === b[i]);
}

/** Spec 005 D8 step 2: the project's listed files, or those of them the command names. */
function nodeTestFiles(command: NodeTestCommand, listing: Listing): readonly TestFileRef[] | null {
  const own = listing.files.filter((ref) => ref.project === command.project);
  if (command.files === null) return own.length === 0 ? null : own;
  const byPath = new Map(own.map((ref) => [ref.path, ref]));
  const files = command.files.map((file) => byPath.get(listing.pathOf(file) ?? ""));
  return files.every((ref) => ref !== undefined) ? [...new Set(files as TestFileRef[])] : null;
}
