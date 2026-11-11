import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach } from "vitest";

/*
 * Spec 018 D20, row 018-33: a temporary checkout of Squeal as GitHub gives
 * the action, with `ci/` copied from this repository, a `package.json` that
 * states a Node floor, and a stub in place of the bundled CLI. `/tmp` where
 * there is one: this host's temp directory can lie inside a checkout.
 */

export const REPO = resolve(import.meta.dirname, "../..");
const BASE = existsSync("/tmp") ? "/tmp" : tmpdir();

/** The relative path of the bundled CLI in a checkout of Squeal. */
export const CLI = "plugins/claude-code/dist/cli/squeal.mjs";

/** Squeal's own floor, `engines.node` without its `>=`. */
export const FLOOR = (
  JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { engines: { node: string } }
).engines.node.slice(">=".length);

/**
 * A stub CLI: it logs its arguments to `STUB_LOG`, prints 9.9.9 for
 * `--version`, runs `ci record`'s command and exits with its code, and
 * exits with `STUB_EXIT` (default 0) for anything else.
 */
export const STUB_CLI = `import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
if (process.env.STUB_LOG) appendFileSync(process.env.STUB_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") {
  process.stdout.write("9.9.9\\n");
  process.exit(0);
}
if (args[0] === "ci" && args[1] === "record") {
  const at = args.indexOf("--");
  const run = spawnSync(args[at + 1], args.slice(at + 2), { stdio: "inherit" });
  process.exit(run.status ?? 1);
}
process.exit(Number(process.env.STUB_EXIT ?? "0"));
`;

/** A CLI that cannot start: it throws as it loads. */
export const BROKEN_CLI = `throw new Error("broken bundle");\n`;

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function scratch(name: string): string {
  const dir = mkdtempSync(join(BASE, `squeal-ci-action-${name}-`));
  made.push(dir);
  return dir;
}

export interface Checkout {
  /** The checkout's root, where GitHub puts the action's repository. */
  readonly root: string;
  /** `$GITHUB_ACTION_PATH`: `ci/` in the checkout. */
  readonly action: string;
  /** Where the workflow files and logs of one test go. */
  readonly files: string;
}

/** A checkout of Squeal with this repository's `ci/`, `floor` as its Node floor and `cli` as its CLI. */
export function checkout(
  options: { readonly floor?: string; readonly cli?: string | null } = {},
): Checkout {
  const root = scratch("checkout");
  cpSync(join(REPO, "ci"), join(root, "ci"), { recursive: true });
  const engines = { node: `>=${options.floor ?? FLOOR}` };
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "squeal", engines }));
  const cli = options.cli === undefined ? STUB_CLI : options.cli;
  if (cli !== null) {
    mkdirSync(dirname(join(root, CLI)), { recursive: true });
    writeFileSync(join(root, CLI), cli);
  }
  const files = join(root, "files");
  mkdirSync(files);
  for (const name of ["summary.md", "path", "env", "log"]) writeFileSync(join(files, name), "");
  return { root, action: join(root, "ci"), files };
}

/** A `PATH` with this test's Node first, then the system's tools. */
export const NODE_PATH = [dirname(process.execPath), "/usr/bin", "/bin"].join(":");

export interface Ran {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** What the step wrote to `$GITHUB_STEP_SUMMARY`. */
  readonly summary: string;
  /** The stub CLI's calls, one argument list each. */
  readonly calls: readonly (readonly string[])[];
}

/** Runs `program` with `args` as a workflow step would, with the checkout's workflow files. */
export function step(
  at: Checkout,
  program: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Ran {
  const files = at.files;
  const run = spawnSync(program, args, {
    encoding: "utf8",
    env: {
      PATH: NODE_PATH,
      GITHUB_STEP_SUMMARY: join(files, "summary.md"),
      GITHUB_PATH: join(files, "path"),
      GITHUB_ENV: join(files, "env"),
      STUB_LOG: join(files, "log"),
      ...env,
    },
  });
  const read = (name: string) => readFileSync(join(files, name), "utf8");
  const ran = {
    code: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    summary: read("summary.md"),
    calls: read("log")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as string[]),
  };
  for (const name of ["summary.md", "log"]) writeFileSync(join(files, name), "");
  return ran;
}

/** What the checkout's setup wrote to `$GITHUB_PATH` and `$GITHUB_ENV`. */
export function workflowFiles(at: Checkout): { path: string; env: string } {
  return {
    path: readFileSync(join(at.files, "path"), "utf8"),
    env: readFileSync(join(at.files, "env"), "utf8"),
  };
}
