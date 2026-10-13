import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import { git } from "../../hash/git-repo.js";
import {
  capture,
  cleanupFixtures,
  harnessEnv,
  json,
  squealShaped,
  VITEST_GATE,
} from "./fixture.js";

/* Spec 005 D3 step 4, row 005-12: `squeal init` takes one flag per setup choice. */

afterEach(cleanupFixtures);

const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");

async function init(root: string, args: readonly string[]) {
  const { io, out } = capture(root);
  const code = await main(["init", ...args], io);
  return { code, ...out };
}

describe("squeal init with no new flag", () => {
  it("behaves as before: settings and nothing else", async () => {
    const root = squealShaped();
    const config = read(root, "squeal.config.json");
    const { code, stdout } = await init(root, []);
    expect(code).toBe(0);
    expect(stdout).toContain("squeal init: kept squeal.config.json");
    expect(stdout).toContain("squeal init: enabled squeal@hearsay in .claude/settings.json");
    expect(stdout).not.toMatch(/gate line|Squeal block|slow\.include|inputs\[/);
    expect(read(root, "CLAUDE.md")).toBe(`# Agents\n\n${VITEST_GATE}\n`);
    expect(read(root, "squeal.config.json")).toBe(config);
    expect(git(root, ["status", "--porcelain"])).toBe("?? .claude/settings.json\n");
  });
});

describe("squeal init with setup choices", () => {
  it("applies each choice, after which setup --check finds nothing outdated", async () => {
    const root = squealShaped();
    const { code, stdout, stderr } = await init(root, [
      "--gate",
      "CLAUDE.md:3=reword",
      "--block",
      "AGENTS.md",
      "--slow",
      "test/e2e/**/*.test.ts",
      "--input=test/e2e/*.test.ts=plugins/**",
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain(
      [
        "squeal init: reworded gate line CLAUDE.md:3",
        "squeal init: wrote the Squeal block to AGENTS.md",
        "squeal init: added test/e2e/**/*.test.ts to slow.include in squeal.config.json",
        'squeal init: added plugins/** to inputs["test/e2e/*.test.ts"] in squeal.config.json',
        "",
      ].join("\n"),
    );
    const claude = read(root, "CLAUDE.md");
    expect(claude).toContain("`squeal run --all --wait 110000`. Paste the output");
    expect(claude).toContain("<!-- squeal:begin v1");
    expect(JSON.parse(read(root, "squeal.config.json"))).toEqual({
      inputs: {
        "test/e2e/*.test.ts": ["plugins/claude-code/**", "plugins/codex/**", "plugins/**"],
      },
      slow: { include: ["test/e2e/**/*.test.ts"] },
    });
    const check = capture(root);
    expect(await main(["setup", "--check"], check.io)).toBe(0);

    // Again: the block is current, the globs are there, and nothing changes.
    const again = await init(root, [
      "--block",
      "CLAUDE.md",
      "--slow",
      "test/e2e/**/*.test.ts",
      "--gate",
      "AGENTS.md:1=keep",
    ]);
    expect(again.code).toBe(1);
    expect(again.stderr).toBe(
      "squeal init: no gate line AGENTS.md:1; squeal setup --plan lists them; nothing changed\n",
    );
    const repeat = await init(root, ["--block", "CLAUDE.md", "--slow", "test/e2e/**/*.test.ts"]);
    expect(repeat.code).toBe(0);
    expect(repeat.stdout).toContain("squeal init: the Squeal block in CLAUDE.md is current\n");
    expect(repeat.stdout).not.toContain("slow.include");
    expect(read(root, "CLAUDE.md")).toBe(claude);
  });

  it("changes nothing when a choice cannot apply", async () => {
    const root = squealShaped({ "squeal.config.json": json({ inputs: ["fixtures/**"] }) });
    const cases: [string[], string][] = [
      [["--gate", "CLAUDE.md:9=reword"], "no gate line CLAUDE.md:9"],
      [
        ["--block", "../elsewhere.md"],
        '--block takes a file inside the worktree, not "../elsewhere.md"',
      ],
      [["--input", "test/**=fixtures/**"], "inputs in squeal.config.json is a list"],
      [["--slow", "!test/**"], "negated input glob is not supported"],
    ];
    for (const [args, message] of cases) {
      const { code, stderr } = await init(root, args);
      expect(code, args.join(" ")).toBe(1);
      expect(stderr).toContain(message);
      expect(stderr).toMatch(/; nothing changed\n$/);
    }
    writeFileSync(join(root, "CLAUDE.md"), "<!-- squeal:begin v1 -->\nhalf\n");
    const unterminated = await init(root, ["--block", "AGENTS.md"]);
    expect(unterminated.stderr).toContain("AGENTS.md:1: a Squeal block begins with no end");
    expect(existsSync(join(root, ".claude", "settings.json"))).toBe(false);
  });

  it("refuses to reword a compound gate and writes nothing (review 005-13 B2)", async () => {
    const compound = "Run `npm run lint && npx vitest run && npm run build`.\n";
    const root = squealShaped({ "CLAUDE.md": compound });
    const { code, stdout, stderr } = await init(root, ["--gate", "CLAUDE.md:1=reword"]);
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      "squeal init: CLAUDE.md:1: runs more than the test command: `npm run lint && npx vitest run && npm run build`; reword it by hand; nothing changed\n",
    );
    expect(read(root, "CLAUDE.md")).toBe(compound);
    expect(existsSync(join(root, ".claude", "settings.json"))).toBe(false);
  });

  it("refuses malformed flags as usage errors", async () => {
    const root = squealShaped();
    for (const args of [
      ["--gate", "CLAUDE.md:3"],
      ["--gate", "CLAUDE.md:3=maybe"],
      ["--input", "test/**"],
      ["--block", "CLAUDE.md", "--block", "none"],
      ["--slow"],
      ["--harness", "codex", "--print-launcher-config", "--block", "none"],
    ]) {
      const { code, stderr } = await init(root, args);
      expect(code, args.join(" ")).toBe(2);
      expect(stderr).toContain("[--block <file|none>]");
    }
  });

  it("applies the choices with --harness codex too", async () => {
    const root = squealShaped();
    const { code, stdout } = await init(root, ["--harness", "codex", "--block", "none"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Each user installs the Codex plugin once");
    expect(stdout).toContain("squeal init: wrote no Squeal block\n");
  });
});

describe("the Codex install hint (row 005-40)", () => {
  const HINT = "Each user installs the Codex plugin once";
  const count = (text: string) => text.split(HINT).length - 1;

  it("is printed once per setup run without the plugin, and never with it", async () => {
    const root = squealShaped();
    const env = harnessEnv(["claude", "codex"]);
    const args = ["setup", "--yes", "--harness", "codex", "--block", "none", "--no-warmup"];
    const without = capture(root, env);
    expect(await main(args, without.io)).toBe(0);
    expect(count(without.out.stdout)).toBe(1);

    mkdirSync(join(env.HOME as string, ".codex/plugins/cache/hearsay/squeal/0.1.151"), {
      recursive: true,
    });
    const init = capture(root, env);
    expect(await main(["init", "--harness", "codex"], init.io)).toBe(0);
    expect(init.out.stdout).toContain("squeal init: kept squeal.config.json");
    expect(count(init.out.stdout)).toBe(0);
  });
});
