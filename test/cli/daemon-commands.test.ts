import { mkdtempSync, realpathSync, rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { git } from "../hash/git-repo.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = realpathSync(mkdtempSync("/tmp/squeal-cli-"));
  dirs.push(dir);
  return dir;
}

async function run(argv: string[], cwd: string) {
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
  };
  const code = await main(argv, io);
  return { code, stdout, stderr };
}

describe("daemon commands: usage and no-daemon answers", () => {
  it("lists the daemon commands in the help", async () => {
    const { code, stdout } = await run(["--help"], tempDir());
    expect(code).toBe(0);
    for (const command of [
      "start [root]",
      "run --all [--force] [--wait]",
      "stop [root]",
      "daemon <root>",
    ]) {
      expect(stdout).toContain(`squeal ${command}`);
    }
  });

  it("rejects bad arguments with exit code 2", async () => {
    const cwd = tempDir();
    expect((await run(["daemon"], cwd)).code).toBe(2);
    expect((await run(["daemon", "a", "b"], cwd)).code).toBe(2);
    expect((await run(["run"], cwd)).stderr).toContain("--all is required");
    expect((await run(["run", "--all", "--fast"], cwd)).code).toBe(2);
    expect((await run(["start", "--now"], cwd)).code).toBe(2);
    expect((await run(["stop", "a", "b"], cwd)).code).toBe(2);
  });

  it("says when the directory is not inside a git worktree", async () => {
    const result = await run(["stop"], tempDir());
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/is not inside a git worktree/);
  });

  it("stop and run --all with no daemon running answer at once", async () => {
    const root = tempDir();
    git(root, ["init", "-q"]);
    const saved = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = root;
    try {
      const stop = await run(["stop"], root);
      expect(stop).toMatchObject({ code: 0, stdout: `No daemon running for ${root}\n` });
      const runAll = await run(["run", "--all"], root);
      expect(runAll.code).toBe(1);
      expect(runAll.stderr).toBe(
        `squeal: no daemon running for ${root}; start one with squeal start\n`,
      );
    } finally {
      if (saved === undefined) delete process.env.XDG_RUNTIME_DIR;
      else process.env.XDG_RUNTIME_DIR = saved;
    }
  });

  it("squeal daemon exits 1 with a reason for a directory that is not a worktree", async () => {
    const result = await run(["daemon", tempDir()], tempDir());
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/is not a git worktree root/);
  });
});
