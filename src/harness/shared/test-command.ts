import type { NodeTestProject } from "../../core/types/index.js";
import { type PytestCommand, type PytestHere, pytestCommand } from "./test-command-pytest.js";

/*
 * Spec 005 D8 step 1: recognize an agent's own test command, narrowly. The
 * rule is resolve or fall through: anything not recognized here runs as
 * normal, so every doubt is `null`.
 */

/** A recognized test command: what it runs, before resolution to test files. */
export type TestCommand =
  | {
      readonly runner: "vitest";
      /** Vitest's filename filters, as written; none runs every test file. */
      readonly filters: readonly string[];
    }
  | {
      readonly runner: "node-test";
      /** The `nodeTest` project whose own command it is. */
      readonly project: string;
      /** The test files it was narrowed to, as written; `null` runs the project's every file. */
      readonly files: readonly string[] | null;
    }
  | PytestCommand;

/** What recognition reads besides the command: the root `package.json`'s scripts and the policy. */
export interface CommandContext {
  readonly scripts: Readonly<Record<string, string>>;
  readonly nodeTest: readonly NodeTestProject[];
  /** Spec 007 D8: the pytest projects run from the command's directory. Absent means none. */
  readonly pytest?: readonly PytestHere[];
  /** `false` when the command runs from a directory other than the worktree root, where only pytest is recognized. Absent means `true`. */
  readonly atRoot?: boolean;
}

/**
 * The test command `command` is, or `null` for one that falls through: a
 * chain, pipe, redirect, subshell, expansion or leading assignment, another
 * runner, a workspace flag, or a flag that changes what runs.
 */
export function recognizeTestCommand(command: string, context: CommandContext): TestCommand | null {
  const words = shellWords(command);
  if (words === null) return null;
  const atRoot =
    context.atRoot === false
      ? null
      : (vitestCommand(words) ?? npmCommand(words, context) ?? nodeTestCommand(words, context));
  return atRoot ?? pytestCommand(words, context.pytest ?? []);
}

/**
 * Spec 005 D8: the shell command of a `Bash` call's hook input, from its
 * `tool_input.command`, as both harnesses send it; nothing for another tool.
 */
export function bashCommand(input: Readonly<Record<string, unknown>>): { command?: string } {
  const toolInput = input.tool_input;
  if (input.tool_name !== "Bash" || typeof toolInput !== "object" || toolInput === null) return {};
  const { command } = toolInput as Record<string, unknown>;
  return typeof command === "string" ? { command } : {};
}

/** Vitest's reporters flag, with its value next or after `=`. */
const REPORTER = "--reporter";
/** `--silent`'s values (Vitest's `silent` option); bare, it takes the next word if it is not a flag. */
const SILENT_VALUES: ReadonlySet<string> = new Set(["true", "false", "yes", "no", "passed-only"]);

/**
 * `vitest run` or `npx vitest run`, then filters and only `--silent` and
 * `--reporter`. A filter with a line number (`file.test.ts:12`) narrows to
 * tests, as `-t` does, and falls through.
 */
function vitestCommand(words: readonly string[]): TestCommand | null {
  const start = words[0] === "npx" ? 1 : 0;
  if (words[start] !== "vitest" || words[start + 1] !== "run") return null;
  const filters: string[] = [];
  const rest = words.slice(start + 2);
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i] as string;
    if (word === "--silent") {
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        if (!SILENT_VALUES.has(next)) return null;
        i++;
      }
    } else if (word.startsWith("--silent=")) {
      if (!SILENT_VALUES.has(word.slice("--silent=".length))) return null;
    } else if (word === REPORTER) {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("-")) return null;
      i++;
    } else if (word.startsWith(`${REPORTER}=`)) {
      if (word === `${REPORTER}=`) return null;
    } else if (word.startsWith("-") || word === "" || /:\d+(-\d+)?$/.test(word)) {
      return null;
    } else {
      filters.push(word);
    }
  }
  return { runner: "vitest", filters };
}

/**
 * `npm test` or `npm run <script>` with no arguments, when the root
 * `package.json` script is exactly one Vitest form and has no `pre` or
 * `post` script beside it, which npm would run too.
 */
function npmCommand(words: readonly string[], context: CommandContext): TestCommand | null {
  if (words[0] !== "npm") return null;
  const name =
    words.length === 2 && words[1] === "test"
      ? "test"
      : words.length === 3 && words[1] === "run"
        ? words[2]
        : undefined;
  if (name === undefined) return null;
  const { scripts } = context;
  if (!Object.hasOwn(scripts, name)) return null;
  if (Object.hasOwn(scripts, `pre${name}`) || Object.hasOwn(scripts, `post${name}`)) return null;
  const script = shellWords(scripts[name] as string);
  return script === null ? null : vitestCommand(script);
}

/**
 * A configured `nodeTest` project's own command, `<node> <argv...> --test
 * <include...>` run from the worktree root with no `env` of its own, or the
 * same with the globs replaced by literal test-file paths.
 */
function nodeTestCommand(words: readonly string[], context: CommandContext): TestCommand | null {
  const at = words.indexOf("--test");
  if (at === -1) return null;
  const argv = words.slice(1, at);
  const args = words.slice(at + 1);
  if (args.length === 0) return null;
  const project = context.nodeTest.find(
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

/**
 * Characters a shell acts on outside quotes. Newlines chain; `#` starts a
 * comment; `*?[]{}~` expand to paths only the shell would know.
 */
const SPECIAL = /[|&;()<>$`\\#*?[\]{}~!\n\r]/;

/**
 * The words of `text` with quotes removed, or `null` when a shell would act
 * on anything in it: chains, pipes, redirects, subshells, expansions and
 * globs, or a leading assignment. Single quotes keep everything; double
 * quotes refuse `$`, `` ` `` and `\`.
 */
export function shellWords(text: string): string[] | null {
  const words: string[] = [];
  let word: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (char === " " || char === "\t") {
      if (word !== null) words.push(word);
      word = null;
    } else if (char === "'" || char === '"') {
      const end = text.indexOf(char, i + 1);
      if (end === -1) return null;
      const quoted = text.slice(i + 1, end);
      if (char === '"' && /[$`\\]/.test(quoted)) return null;
      word = (word ?? "") + quoted;
      i = end;
    } else if (SPECIAL.test(char)) {
      return null;
    } else {
      word = (word ?? "") + char;
    }
  }
  if (word !== null) words.push(word);
  if (words.length === 0 || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] as string)) return null;
  return words;
}
