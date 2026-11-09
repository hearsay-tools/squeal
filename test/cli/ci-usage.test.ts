import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("squeal ci", () => {
  it.each([
    [[], "no subcommand"],
    [["publish"], 'unknown "publish"'],
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
  });

  it("runs a command it cannot record unchanged, with its code, and writes nothing", async () => {
    const plain = mkdtempSync(join(BASE, "squeal-ci-usage-"));
    dirs.push(plain);
    const outside = capture(plain);
    expect(await ciCommand(["record", "--", ...exit(4)], outside.io)).toBe(4);
    expect(outside.text()).toContain("is not inside a git worktree; the command runs unchanged");

    execFileSync("git", ["init", "-q"], { cwd: plain });
    const noVitest = capture(plain);
    expect(await ciCommand(["record", "--", ...exit(5)], noVitest.io)).toBe(5);
    expect(noVitest.text()).toContain("only Vitest is supported");
    expect(readdirSync(plain)).toEqual([".git"]);

    const missing = capture(plain);
    expect(await ciCommand(["record", "--", join(plain, "no-such-program")], missing.io)).toBe(127);
    expect(missing.text()).toContain("could not run");
  });
});
