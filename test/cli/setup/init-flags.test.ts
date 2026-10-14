import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import { git } from "../../hash/git-repo.js";
import {
  capture,
  cezarionShaped,
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
    expect(claude).toContain("`squeal run --all --wait 110000`. If it exits 3 at its deadline");
    expect(claude).toContain("instead. Paste the output in your final message.");
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

  // Row 005-55: a line that only names the test command is listed by the plan, never reworded.
  it("refuses to reword a mention, naming the plan, and writes nothing", async () => {
    const mention = "The `npm test` command runs the unit suite.\n";
    const root = squealShaped({ "CLAUDE.md": mention });
    const { code, stdout, stderr } = await init(root, ["--gate", "CLAUDE.md:1=reword"]);
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      "squeal init: no gate line CLAUDE.md:1; squeal setup --plan lists them; nothing changed\n",
    );
    expect(read(root, "CLAUDE.md")).toBe(mention);
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

/*
 * Row 005-40, `research/e2e-setup.md` defect 4: two of four model sessions
 * gave a test glob that selects no test file, and setup wrote it as given.
 */
describe("a --slow or --input test glob", () => {
  const config = (root: string) => JSON.parse(read(root, "squeal.config.json"));
  const setup = async (root: string, args: readonly string[]) => {
    const { io, out } = capture(root, harnessEnv(["claude"]));
    const code = await main(
      ["setup", "--yes", "--harness", "claude-code", "--no-warmup", ...args],
      io,
    );
    return { code, ...out };
  };

  it("takes a bare directory as <dir>/** and says so: the Codex session's flags", async () => {
    const root = squealShaped();
    const { code, stdout, stderr } = await setup(root, [
      "--block",
      "CLAUDE.md",
      "--gate",
      "CLAUDE.md:3=reword",
      "--slow",
      "test/e2e",
      "--input",
      "test/e2e=plugins/**",
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout.indexOf("squeal setup: took test/e2e as test/e2e/**\n")).toBe(0);
    expect(stdout.split("took test/e2e as").length, "said once").toBe(2);
    expect(stdout).toContain("squeal init: added test/e2e/** to slow.include");
    expect(config(root).slow).toEqual({ include: ["test/e2e/**"] });
    expect(config(root).inputs["test/e2e/**"]).toEqual(["plugins/**"]);
    expect(await main(["setup", "--check"], capture(root).io)).toBe(0);
  });

  it("takes --input <glob>=none as no input: the Claude Code session's flags on cezarion", async () => {
    for (const slow of ["packages/cezar/test/e2e/**", "packages/cezar/test/e2e"]) {
      const root = cezarionShaped();
      const { code, stdout, stderr } = await setup(root, [
        "--block",
        "AGENTS.md",
        "--slow",
        slow,
        "--input",
        `${slow}=packages/cezar/dist/**`,
        "--input",
        "packages/cezar/test/unit/**=none",
      ]);
      expect(stderr, slow).toBe("");
      expect(code, slow).toBe(0);
      expect(stdout).toContain("squeal setup: no input for packages/cezar/test/unit/**\n");
      expect(config(root).slow.include).toEqual(["packages/cezar/test/e2e/**"]);
      expect(config(root).inputs).toEqual({
        "packages/cezar/test/e2e/**": ["packages/cezar/dist/**"],
      });
    }
  });

  it("takes an input directory as <dir>/**, built or tracked", async () => {
    const root = cezarionShaped();
    const { code, stdout } = await init(root, [
      "--input",
      "packages/cezar/test/e2e/*.test.ts=packages/cezar/dist",
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("squeal init: took packages/cezar/dist as packages/cezar/dist/**\n");
    expect(config(root).inputs).toEqual({
      "packages/cezar/test/e2e/*.test.ts": ["packages/cezar/dist/**"],
    });
  });

  it("is refused, naming it, when it selects no test file", async () => {
    const root = squealShaped();
    const cases: [string[], string][] = [
      [["--slow", "test/nothing/**"], "--slow test/nothing/** selects no test file"],
      [["--slow", "test/e2e/helpers.ts"], "--slow test/e2e/helpers.ts selects no test file"],
      [
        ["--input", "test/none=plugins/**"],
        "--input test/none=plugins/**: test/none selects no test file",
      ],
      [
        ["--input", "test/none/**=none"],
        "--input test/none/**=none: test/none/** selects no test file",
      ],
    ];
    for (const [args, message] of cases) {
      const viaInit = await init(root, args);
      expect(viaInit.code, args.join(" ")).toBe(1);
      expect(viaInit.stderr).toBe(`squeal init: ${message}; nothing changed\n`);
      const viaSetup = await setup(root, args);
      expect(viaSetup.code, args.join(" ")).toBe(1);
      expect(viaSetup.stdout).toBe("");
      expect(viaSetup.stderr).toBe(`squeal setup: ${message}; nothing changed\n`);
    }
    expect(git(root, ["status", "--porcelain"])).toBe("");
  });
});

describe("setup --check", () => {
  it("names a slow.include entry or inputs key that selects no test file", async () => {
    const root = squealShaped({
      "squeal.config.json": json({
        slow: { include: ["test/e2e"] },
        inputs: {
          "test/e2e/*.test.ts": ["plugins/**"],
          "packages/cezar/test/unit/**": ["none"],
        },
      }),
    });
    const { io, out } = capture(root);
    expect(await main(["setup", "--check"], io)).toBe(1);
    expect(out.stdout).toContain(
      'squeal.config.json: the slow.include entry "test/e2e" selects no test file; a directory takes /**: "test/e2e/**"\n',
    );
    expect(out.stdout).toContain(
      'squeal.config.json: the inputs key "packages/cezar/test/unit/**" selects no test file\n',
    );
    const plan = capture(root);
    await main(["setup", "--plan", "--json"], plan.io);
    expect(JSON.parse(plan.out.stdout).outdated).toHaveLength(2);
  });
});

describe("a test glob over a node:test project's exclusions (review 005-42 B1)", () => {
  const VITEST_SRC = `export default { test: { include: ["packages/cezar/src/**/*.test.ts"] } };\n`;
  const unit = (extra: Record<string, unknown>[] = []) =>
    json({
      slow: { include: [] },
      nodeTest: [
        {
          name: "unit",
          cwd: "packages/cezar",
          include: ["test/unit/*.test.ts"],
          exclude: ["test/unit/a.test.ts"],
        },
        ...extra,
      ],
      inputs: {},
    });
  const EXCLUDED = "packages/cezar/test/unit/a.test.ts";
  const args = ["--slow", EXCLUDED, "--input", `${EXCLUDED}=packages/cezar/dist/**`];

  it("is refused on both write paths when only an excluded file matches", async () => {
    const root = cezarionShaped({ "vitest.config.ts": VITEST_SRC, "squeal.config.json": unit() });
    const viaInit = await init(root, ["--harness", "codex", "--block", "none", ...args]);
    expect(viaInit.code).toBe(1);
    expect(viaInit.stderr).toBe(
      `squeal init: --slow ${EXCLUDED} selects no test file; nothing changed\n`,
    );
    const { io, out } = capture(root, harnessEnv(["claude"]));
    const viaSetup = await main(
      ["setup", "--yes", "--harness", "claude-code", "--no-warmup", "--block", "none", ...args],
      io,
    );
    expect(viaSetup).toBe(1);
    expect(out.stderr).toBe(
      `squeal setup: --slow ${EXCLUDED} selects no test file; nothing changed\n`,
    );
    expect(git(root, ["status", "--porcelain"])).toBe("");
  });

  it("makes setup --check exit 1 for one already written", async () => {
    const root = cezarionShaped({
      "vitest.config.ts": VITEST_SRC,
      "squeal.config.json": json({
        ...JSON.parse(unit()),
        slow: { include: [EXCLUDED] },
        inputs: { [EXCLUDED]: ["packages/cezar/dist/**"] },
      }),
    });
    const { io, out } = capture(root);
    expect(await main(["setup", "--check"], io)).toBe(1);
    expect(out.stdout).toContain(
      `squeal.config.json: the slow.include entry "${EXCLUDED}" selects no test file\n`,
    );
    expect(out.stdout).toContain(
      `squeal.config.json: the inputs key "${EXCLUDED}" selects no test file\n`,
    );
  });

  it("still validates a file another project or Vitest lists", async () => {
    const other = { name: "a", cwd: "packages/cezar/test", include: ["unit/a.test.ts"] };
    const cases = {
      "another node:test project": {
        "vitest.config.ts": VITEST_SRC,
        "squeal.config.json": unit([other]),
      },
      Vitest: { "squeal.config.json": unit() },
    };
    for (const [lister, files] of Object.entries(cases)) {
      const root = cezarionShaped(files);
      const { code, stderr } = await init(root, ["--harness", "codex", "--block", "none", ...args]);
      expect(stderr, lister).toBe("");
      expect(code, lister).toBe(0);
      expect(JSON.parse(read(root, "squeal.config.json")).slow.include, lister).toEqual([EXCLUDED]);
      expect(await main(["setup", "--check"], capture(root).io), lister).toBe(0);
    }
  });
});
