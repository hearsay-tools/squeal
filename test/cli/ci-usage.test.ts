import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ciCommand } from "../../src/cli/ci.js";
import { type CliIo, main } from "../../src/cli/main.js";

/*
 * Spec 018 D8, row 018-16: `squeal ci record`'s usage, and a command it
 * cannot record, which runs unchanged and keeps its exit code. `/tmp` where
 * there is one: this host's temp directory can lie in a checkout whose
 * `node_modules` holds Vitest.
 */

const BASE = existsSync("/tmp") ? "/tmp" : tmpdir();
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function capture(cwd: string): { io: CliIo; text: () => string } {
  let text = "";
  const add = (chunk: string) => {
    text += chunk;
  };
  return { io: { stdout: add, stderr: add, cwd, env: process.env }, text: () => text };
}

const exit = (code: number) => [process.execPath, "-e", `process.exit(${code})`];

/** tsx's loader by URL, since the CLI runs in a directory with no node_modules. */
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const CLI = resolve(import.meta.dirname, "../../src/cli/index.ts");

function scratch(): string {
  const dir = mkdtempSync(join(BASE, "squeal-ci-usage-"));
  dirs.push(dir);
  return dir;
}

/**
 * The CLI in a process of its own at `cwd`, so `vitest` resolves from `cwd`
 * as it does for a user, not through this test process's module context
 * (review wave-5 S1). Its environment names no module path, and its HOME is
 * a scratch directory.
 */
function cli(args: readonly string[], cwd: string): { code: number | null; text: string } {
  const env = { PATH: process.env.PATH ?? "", HOME: scratch() };
  const flags = ["--disable-warning=ExperimentalWarning", "--import", TSX, CLI];
  const run = spawnSync(process.execPath, [...flags, ...args], { cwd, env, encoding: "utf8" });
  return { code: run.status, text: `${run.stdout}${run.stderr}` };
}

describe("squeal ci", () => {
  it.each([
    [[], "no subcommand"],
    [["fetch"], 'unknown "fetch"'],
    [["record"], "no command: put it after --"],
    [["record", "--out"], "--out names no directory"],
    [["record", "--keep", "1", "--", "true"], 'unknown argument "--keep"'],
    [["record", "--"], "no command after --"],
  ])("exits 2 on %j", async (args, text) => {
    const { io, text: said } = capture(BASE);
    expect(await ciCommand(args, io)).toBe(2);
    expect(said()).toContain(text);
    expect(said()).toContain("usage: squeal ci record");
  });

  it("is a command of the CLI, with its help", async () => {
    const { io, text } = capture(BASE);
    expect(await main(["ci", "--help"], io)).toBe(0);
    expect(text()).toContain("squeal ci record [--out <dir>] -- <command>");
    // Spec 018 D28 (row 018-47): the reporter variable and the refused flags.
    const help = text().replace(/\s+/g, " ");
    expect(help).toContain(
      '--test-reporter="$SQUEAL_NODE_TEST_REPORTER" --test-reporter-destination=stderr',
    );
    expect(help).toContain(
      "--test-isolation=none, --test-name-pattern, --test-skip-pattern, --test-only or --watch",
    );
    // Spec 020 D13.6 and D19.4: when the provider is added, when the project's is read, when neither.
    const said = text().replace(/\s+/g, " ");
    expect(said).toContain(
      "With no coverage of the run's own, it adds Squeal's coverage provider to the run (not when Node lacks process.getBuiltinModule).",
    );
    expect(said).toContain(
      "With the run's own V8 coverage (coverage.enabled, --coverage) on Vitest 4.1 or 5.0, it adds none and reads that provider's data: the project's report and thresholds stay its own.",
    );
    expect(said).toContain(
      "With Istanbul, a custom provider, browser mode or another Vitest version, it records no coverage.",
    );
    // Spec 018 D8's condition as D34 amends it (row 018-57): the endpoint hashes and the residual.
    expect(said).toContain(
      "Requires that no other program changes the tests' input files while the command runs. Squeal sees the reads and writes of the command's Node processes, and hashes the checkout before and after the command: an input that no Node process read, listed or wrote is exported when both hashes equal its content in the export's checkout. So a change another program makes, and restores before the command ends, can be exported at content the test did not see",
    );
  });

  it("runs a command outside a git worktree unchanged, with its code", async () => {
    const plain = scratch();
    const outside = capture(plain);
    expect(await ciCommand(["record", "--", ...exit(4)], outside.io)).toBe(4);
    expect(outside.text()).toContain("is not inside a git worktree; the command runs unchanged");
  });

  // Two CLI processes, each compiling the source through tsx: about a
  // second alone, more on a loaded host.
  it("runs a command where vitest does not resolve unchanged, with its code, and writes nothing", {
    timeout: 60_000,
  }, () => {
    const plain = scratch();
    execFileSync("git", ["init", "-q"], { cwd: plain });
    const noVitest = cli(["ci", "record", "--", ...exit(5)], plain);
    expect(noVitest.code).toBe(5);
    // Neither runner here: no Vitest resolves, and the config names no node:test entry.
    expect(noVitest.text).toMatch(
      /squeal\.config\.json has no \w+ entry; the command runs unchanged/,
    );
    expect(readdirSync(plain)).toEqual([".git"]);

    const missing = cli(["ci", "record", "--", join(plain, "no-such-program")], plain);
    expect(missing.code).toBe(127);
    expect(missing.text).toContain("Vitest does not resolve from");
    expect(missing.text).toContain("could not run");
    expect(readdirSync(plain)).toEqual([".git"]);
  });
});
