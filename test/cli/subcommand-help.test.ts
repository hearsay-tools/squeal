import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { fakeRepo } from "../status/helpers.js";

/** Every command `main` dispatches, with the flags its help must name (row 005-69, gh-11). */
const COMMANDS: Record<string, readonly string[]> = {
  status: ["--notes", "--json", "--wait <ms>", "<path>...", "--full"],
  why: ["<check>", "--include-logs", "--json"],
  failures: ["--all-worktrees", "--since <duration>", "--json"],
  init: ["--harness codex", "--print-launcher-config", "--trust", "--yes", "--block", "--gate"],
  setup: ["--plan", "--check", "--yes", "--harness", "--block", "--gate", "--slow", "--input"],
  warmup: ["squeal warmup"],
  daemon: ["<root>", "--await-lock <ms>"],
  start: ["[root]"],
  run: ["--all", "--fast", "--slow", "--force", "--wait"],
  retry: ["--reason load|environment", "--cancel"],
  stop: ["[root]"],
  hold: ["--max <duration>", "-- <command> [args...]"],
  remove: ["--config"],
  update: ["squeal update"],
};

function run(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    env: {},
  };
  return { code: main(argv, io), out: () => ({ stdout, stderr }) };
}

/** Every path under `dir` with its size and modification time: a write anywhere changes it. */
function snapshot(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .sort()
    .map((path) => {
      const stats = statSync(join(dir, path));
      return `${path} ${stats.size} ${stats.mtimeMs}`;
    });
}

describe("squeal <command> --help", () => {
  for (const [command, flags] of Object.entries(COMMANDS)) {
    for (const help of ["--help", "-h"]) {
      it(`${command} ${help} prints its flags and exits 0 without work`, () => {
        const repo = fakeRepo();
        const before = snapshot(repo.main);

        const { code, out } = run([command, help], repo.main);

        // A number, not a promise: the help answered before any daemon or store work began.
        expect(code).toBe(0);
        const { stdout, stderr } = out();
        expect(stderr).toBe("");
        expect(stdout).toContain(`squeal ${command}`);
        for (const flag of flags) expect(stdout).toContain(flag);
        expect(snapshot(repo.main)).toEqual(before);
      });
    }

    it(`${command} prints only its own help`, () => {
      const { out } = run([command, "--help"], fakeRepo().main);
      const others = Object.keys(COMMANDS).filter((other) => other !== command);
      const usageLines = out()
        .stdout.split("\n")
        .filter((line) => line.trimStart().startsWith("squeal "));
      expect(usageLines.length).toBeGreaterThan(0);
      for (const line of usageLines) {
        for (const other of others) expect(line).not.toMatch(new RegExp(`squeal ${other}\\b`));
      }
    });

    it(`${command} still exits 2 on an unknown flag`, async () => {
      const repo = fakeRepo();
      const before = snapshot(repo.main);

      const { code, out } = run([command, "--no-such-flag"], repo.main);

      expect(await code).toBe(2);
      expect(out().stdout).toBe("");
      expect(out().stderr).not.toBe("");
      expect(snapshot(repo.main)).toEqual(before);
    });
  }

  it("takes --help after other arguments too", () => {
    const { code, out } = run(["run", "--all", "--wait", "--help"], fakeRepo().main);

    expect(code).toBe(0);
    expect(out().stdout).toContain("squeal run --all");
  });

  it("leaves an unknown command at exit 2", () => {
    const { code, out } = run(["nope", "--help"], fakeRepo().main);

    expect(code).toBe(2);
    expect(out().stderr).toContain('unknown command "nope"');
  });
});
