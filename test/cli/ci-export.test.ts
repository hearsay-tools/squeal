import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ciCommand } from "../../src/cli/ci.js";
import { type CliIo, main } from "../../src/cli/main.js";
import { PART_FORMAT, type Part, writePart } from "../../src/core/ci/parts.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";

/*
 * Spec 018 D9 (row 018-17): `squeal ci export --parts <dir>... [--out
 * <file>]`'s usage, and what it refuses before it starts Vitest: nothing is
 * written, exit 1, the reason named. `test/ci/export.test.ts` exports real
 * shards. `/tmp` where there is one: this host's temp directory can lie in a
 * checkout whose `node_modules` holds Vitest.
 */

const BASE = existsSync("/tmp") ? "/tmp" : tmpdir();
const SCRATCH = resolve(import.meta.dirname, "../fixtures/vitest/.tmp");
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

/** A repository with one commit, inside the repository's tree so its Vitest resolves. */
function repository(): string {
  const root = join(SCRATCH, `ci-export-cli-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  dirs.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "f"],
    {
      cwd: root,
    },
  );
  return root;
}

function part(commit: string): Part {
  return {
    format: PART_FORMAT,
    header: {
      squealVersion: "0.0.0",
      keyFormat: KEY_FORMAT_VERSION,
      runner: "vitest",
      runnerVersion: "5.0.3",
      commit,
      dirty: false,
      shard: { index: 1, count: 1 },
      createdAt: 0,
      source: { kind: "local" },
      end: "completed",
      observing: true,
    },
    projects: [],
    testFiles: [
      { project: "", path: "test/a.test.ts", outcome: "pass", durationMs: 1, checks: [] },
    ],
    evidence: {},
  };
}

describe("squeal ci export", () => {
  it.each([
    [["export"], "no --parts: name the directories the shards wrote"],
    [["export", "--parts"], "--parts names no directory"],
    [["export", "--parts", "--out", "x"], "--parts names no directory"],
    [["export", "--parts=", "--out", "x"], "--parts names no directory"],
    [["export", "--parts", "p", "--out"], "--out names no file"],
    [["export", "--parts", "p", "--keep", "1"], 'unknown argument "--keep"'],
  ])("exits 2 on %j", async (args, text) => {
    const { io, text: said } = capture(BASE);
    expect(await ciCommand(args, io)).toBe(2);
    expect(said()).toContain(text);
    expect(said()).toContain("usage: squeal ci export --parts <dir>... [--out <file>]");
  });

  it("is in the CLI's help", async () => {
    const { io, text } = capture(BASE);
    expect(await main(["ci", "--help"], io)).toBe(0);
    expect(text()).toContain("squeal ci export --parts <dir>... [--out <file>]");
  });

  it("names both subcommands when none is given", async () => {
    const { io, text } = capture(BASE);
    expect(await ciCommand([], io)).toBe(2);
    expect(text()).toContain("usage: squeal ci record");
    expect(text()).toContain("usage: squeal ci export");
  });

  it("exits 1 and writes nothing outside a worktree, without a directory or without a part", async () => {
    const plain = mkdtempSync(join(BASE, "squeal-ci-export-"));
    dirs.push(plain);
    const outside = capture(plain);
    expect(await ciCommand(["export", "--parts", "p"], outside.io)).toBe(1);
    expect(outside.text()).toContain("is not inside a git worktree; wrote nothing");

    execFileSync("git", ["init", "-q"], { cwd: plain });
    const missing = capture(plain);
    expect(await ciCommand(["export", "--parts", "p"], missing.io)).toBe(1);
    expect(missing.text()).toContain(`no directory ${join(plain, "p")}`);

    mkdirSync(join(plain, "p"));
    const empty = capture(plain);
    expect(await ciCommand(["export", "--parts", "p"], empty.io)).toBe(1);
    expect(empty.text()).toContain("no part (squeal-part-*.json) in");
    expect(readdirSync(plain).sort()).toEqual([".git", "p"]);
  });

  it("refuses parts of another commit than the checkout's, before Vitest starts", async () => {
    const root = repository();
    writePart(join(root, "parts"), part("b".repeat(40)));
    const { io, text } = capture(root);
    const out = join(root, "results.json.gz");
    expect(await ciCommand(["export", "--parts", "parts", "--out", out], io)).toBe(1);
    expect(text()).toContain(`refused: the parts are of commit ${"b".repeat(40)}`);
    expect(text()).toContain("wrote nothing");
    expect(existsSync(out)).toBe(false);
    // Row 018-29: a part of an older Squeal holds no cost, and the export says none.
    expect(text()).not.toContain("Squeal's recording took");
  });

  it("names what recording cost the shards, whatever it does with their parts (row 018-29)", async () => {
    const root = repository();
    const older = part("b".repeat(40));
    const cost = { command: "c1", hooksMs: 250, threads: 3, afterMs: 40 };
    const testFiles = older.testFiles.map((file) => ({ ...file, durationMs: 1000 }));
    writePart(join(root, "parts"), { ...older, header: { ...older.header, cost }, testFiles });
    writePart(join(root, "parts"), older);
    const { io, text } = capture(root);
    expect(await ciCommand(["export", "--parts", "parts"], io)).toBe(1);
    expect(text()).toContain(
      "squeal ci export: Squeal's recording took 0.25 s in 3 processes and threads, 25.0% of the test time (1.00 s); 0.04 s more after the command; 1 of 2 parts hold no cost (an older Squeal made them)\n",
    );
    expect(text()).toContain("refused: the parts are of commit");
  });
});
