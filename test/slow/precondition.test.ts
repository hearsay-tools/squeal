import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  argvText,
  checkPrecondition,
  type PreconditionRule,
  preconditionFor,
  touchesPrecondition,
} from "../../src/core/slow/precondition.js";
import { DEFAULT_POLICY, type Policy, type SlowPrecondition } from "../../src/core/types/index.js";

/*
 * Spec 004 D7 and D8 as amended 2026-10-17 (task 004-65, issues #3 and #16):
 * `exists` paths and globs each match a file, an argv `command` exits 0
 * within `timeoutMs`; an unmet one is one reason naming the key.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function worktree(files: readonly string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-004-65-"));
  dirs.push(dir);
  for (const file of files) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), "");
  }
  return dir;
}

const slow = (precondition: SlowPrecondition): PreconditionRule => ({
  precondition,
  source: "slow.precondition",
});
const NODE = process.execPath;

describe("checkPrecondition (spec 004 D7, D8 as amended 2026-10-17)", () => {
  it("is met when every exists entry matches a file, a literal path or a glob", async () => {
    const root = worktree(["dist/index.js", "dist/cli/main.js"]);
    const rule = slow({ exists: ["dist/index.js", "dist/**/*.js", "./dist/cli/*.js"] });
    expect(await checkPrecondition(root, rule)).toBeNull();
  });

  it("names the first exists entry that matches no file", async () => {
    const root = worktree(["dist/other.js"]);
    expect(await checkPrecondition(root, slow({ exists: ["dist/index.js"] }))).toBe(
      "dist/index.js matches no file (slow.precondition.exists)",
    );
    expect(await checkPrecondition(root, slow({ exists: ["dist/**/*.mjs"] }))).toBe(
      "dist/**/*.mjs matches no file (slow.precondition.exists)",
    );
  });

  it("does not look in node_modules or .git unless the glob names them", async () => {
    const root = worktree(["node_modules/pkg/dist/index.js"]);
    expect(await checkPrecondition(root, slow({ exists: ["**/dist/index.js"] }))).not.toBeNull();
    expect(
      await checkPrecondition(root, slow({ exists: ["node_modules/*/dist/index.js"] })),
    ).toBeNull();
  });

  it("runs the command without a shell in the worktree root, met on exit 0", async () => {
    const root = worktree(["dist/index.js"]);
    const check = `require("fs").accessSync("dist/index.js")`;
    expect(await checkPrecondition(root, slow({ command: [NODE, "-e", check] }))).toBeNull();
    // No shell: `&&` is an argument, so a shell's meaning of it cannot run anything.
    const literal = slow({
      command: [NODE, "-e", "process.exit(process.argv[1] === '&&' ? 0 : 1)", "&&"],
    });
    expect(await checkPrecondition(root, literal)).toBeNull();
  });

  it("names the command and its exit code when it fails", async () => {
    const root = worktree();
    const rule = slow({ command: [NODE, "-e", "process.exit(3)"] });
    expect(await checkPrecondition(root, rule)).toBe(
      `${argvText(rule.precondition.command ?? [])} exited 3 (slow.precondition.command)`,
    );
  });

  it("counts a command past timeoutMs, or one that cannot start, as unmet", async () => {
    const root = worktree();
    const hang = slow({ command: [NODE, "-e", "setTimeout(() => {}, 60000)"], timeoutMs: 200 });
    expect(await checkPrecondition(root, hang)).toMatch(
      /did not exit within 200 ms \(slow\.precondition\.command\)$/,
    );
    const missing = slow({ command: ["squeal-004-65-no-such-program"] });
    expect(await checkPrecondition(root, missing)).toMatch(
      /^squeal-004-65-no-such-program could not start: .*ENOENT.* \(slow\.precondition\.command\)$/,
    );
  });

  it("checks exists before it runs the command", async () => {
    const root = worktree();
    const marker = join(root, "ran");
    const rule = slow({
      exists: ["dist/index.js"],
      command: [NODE, "-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "")`],
    });
    expect(await checkPrecondition(root, rule)).toBe(
      "dist/index.js matches no file (slow.precondition.exists)",
    );
    expect(existsSync(marker)).toBe(false);
  });
});

describe("preconditionFor and touchesPrecondition", () => {
  const policy: Policy = {
    ...DEFAULT_POLICY,
    slow: { ...DEFAULT_POLICY.slow, precondition: { exists: ["dist/index.js"] } },
    nodeTest: [
      {
        name: "e2e",
        argv: [],
        env: {},
        include: ["e2e/*.test.js"],
        slow: true,
        precondition: { command: ["true"] },
      },
      { name: "plain", argv: [], env: {}, include: ["plain/*.test.js"], slow: true },
    ],
  };

  it("takes a node:test project's own precondition over slow.precondition", () => {
    expect(preconditionFor(policy, { project: "e2e", path: "e2e/a.test.js" })).toEqual({
      precondition: { command: ["true"] },
      source: 'nodeTest "e2e" precondition',
    });
    expect(preconditionFor(policy, { project: "plain", path: "plain/a.test.js" })?.source).toBe(
      "slow.precondition",
    );
    expect(preconditionFor(DEFAULT_POLICY, { project: "", path: "test/a.test.ts" })).toBeNull();
  });

  it("is touched by any revision for a command, by a path an exists glob selects otherwise", () => {
    const exists = slow({ exists: ["dist/**"] });
    expect(touchesPrecondition(exists, ["src/a.ts"])).toBe(false);
    expect(touchesPrecondition(exists, ["src/a.ts", "dist/index.js"])).toBe(true);
    expect(touchesPrecondition(slow({ command: ["true"] }), ["src/a.ts"])).toBe(true);
  });
});
