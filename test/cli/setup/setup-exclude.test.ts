import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import { terminalAsker } from "../../../src/cli/setup/ask.js";
import { setupCommand } from "../../../src/cli/setup/command.js";
import { buildPlan } from "../../../src/cli/setup/plan.js";
import { git } from "../../hash/git-repo.js";
import {
  ALL_NAMED_E2E,
  capture,
  cezarionShaped,
  cleanupFixtures,
  harnessEnv,
  json,
  squealShaped,
} from "./fixture.js";

/*
 * Spec 005 D3 "Slow tests and build-output tests" steps 3 and 4 (row
 * 005-70): an exclude candidate's question shows the evidence and says Squeal
 * never builds; yes, the default, writes the runner's `exclude`, and no keeps
 * the group a slow candidate, asked whether it is slow.
 */

afterEach(cleanupFixtures);

// Both e2e files name the bundle, so the whole group is the proposal (B1: `exclude-bounded.test.ts`).

const config = (root: string) =>
  JSON.parse(readFileSync(join(root, "squeal.config.json"), "utf8")) as Record<string, unknown>;

async function setup(root: string, args: readonly string[]) {
  const { io, out } = capture(root, harnessEnv(["claude"]));
  const code = await main(["setup", ...args], io);
  return { code, ...out };
}

/** Bare `squeal setup` on a fake terminal with `lines` typed ahead. */
async function onTerminal(root: string, lines: readonly string[]) {
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output = Object.assign(new PassThrough(), { isTTY: true });
  output.resume();
  input.end(lines.map((line) => `${line}\n`).join(""));
  const { io, out } = capture(root, harnessEnv(["claude"]));
  const asker = () => terminalAsker({ input, output });
  const code = await setupCommand(["--no-warmup", "--block", "none"], io, { asker });
  return { code, ...out };
}

const QUESTION = `test/e2e/** (2 files) tests a build output Squeal does not produce:
    plugins/codex/dist: gitignored, named by 2 of 2 test files, such as "plugins/codex/dist/cli/squeal.mjs"
Squeal never builds, so a result against a build it cannot see is tied to no code state. No keeps them a slow candidate. Leave these tests to CI and to runs after a build (vitest.exclude; their inputs entries go too)?`;

describe("squeal setup and an exclude candidate", () => {
  it("--yes writes vitest.exclude, never a slow glob, after which --check finds nothing outdated", async () => {
    const root = squealShaped(ALL_NAMED_E2E);
    const { code, stdout, stderr } = await setup(root, ["--yes", "--no-warmup"]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain(`${QUESTION}\n  exclude (default, --yes)\n`);
    expect(stdout).not.toContain("slow tier?");
    expect(stdout).toContain(
      "squeal init: added test/e2e/** to vitest.exclude in squeal.config.json",
    );
    expect(stdout).toContain(
      'squeal init: removed inputs["test/e2e/*.test.ts"] from squeal.config.json: its test files are excluded',
    );
    expect(config(root)).toEqual({ inputs: {}, vitest: { exclude: ["test/e2e/**"] } });
    const check = await setup(root, ["--check"]);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain('Vitest test files matching "test/e2e/**"');
  });

  it("on a terminal, yes (the default) excludes the group", async () => {
    const root = squealShaped(ALL_NAMED_E2E);
    // Claude Code yes, Codex no, keep the gate, exclude (default).
    const { code, stdout } = await onTerminal(root, ["", "", "keep", ""]);
    expect(code).toBe(0);
    expect(stdout).toContain(`${QUESTION}\n  1. exclude (default)\n  2. keep\n`);
    expect(config(root).vitest).toEqual({ exclude: ["test/e2e/**"] });
    expect(config(root).slow).toBeUndefined();
  });

  it("on a terminal, no keeps the group a slow candidate and asks whether it is slow", async () => {
    const root = squealShaped(ALL_NAMED_E2E);
    const { code, stdout } = await onTerminal(root, ["", "", "keep", "keep", ""]);
    expect(code).toBe(0);
    expect(stdout).toContain("Run these tests in the slow tier?\n  1. slow (default)\n");
    expect(config(root).vitest).toBeUndefined();
    expect(config(root).slow).toEqual({ include: ["test/e2e/**"] });
    expect((await setup(root, ["--check"])).code).toBe(0);
  });

  it("without a terminal or --yes lists the question and writes nothing", async () => {
    const root = squealShaped(ALL_NAMED_E2E);
    const { code, stdout } = await setup(root, []);
    expect(code).toBe(1);
    expect(stdout).toContain(`${QUESTION}\n  1. exclude (default)\n`);
    expect(git(root, ["status", "--porcelain"])).toBe("");
  });

  it("plan names the evidence and the default", async () => {
    const { stdout } = await setup(squealShaped(ALL_NAMED_E2E), ["--plan"]);
    expect(stdout).toContain(
      '  test/e2e (2 files): under a directory named e2e\n    tests build output plugins/codex/dist: gitignored, named by 2 of 2 test files, such as "plugins/codex/dist/cli/squeal.mjs"\n    not declared slow; default excluded (vitest.exclude);',
    );
  });
});

describe("--exclude", () => {
  it("answers the group questions, a bare directory taken as <dir>/**", async () => {
    const root = squealShaped();
    const { code, stdout } = await setup(root, ["--yes", "--exclude", "test/e2e", "--no-warmup"]);
    expect(code).toBe(0);
    expect(stdout).toContain("squeal setup: took test/e2e as test/e2e/**");
    expect(stdout).not.toContain("Leave these tests to CI");
    expect(config(root).vitest).toEqual({ exclude: ["test/e2e/**"] });
  });

  it("goes with --slow none, and refuses a glob that selects no test file", async () => {
    const root = squealShaped();
    const both = await setup(root, [
      "--yes",
      "--slow",
      "none",
      "--exclude",
      "test/e2e/**",
      "--no-warmup",
    ]);
    expect(both.code).toBe(0);
    expect(config(root).vitest).toEqual({ exclude: ["test/e2e/**"] });
    const none = await setup(squealShaped(), ["--yes", "--exclude", "bench/**", "--no-warmup"]);
    expect(none.code).toBe(1);
    expect(none.stderr).toBe(
      "squeal setup: --exclude bench/** selects no test file; nothing changed\n",
    );
  });

  it("writes each runner's exclude that lists the files: cezarion's Vitest and node:test project", async () => {
    const root = cezarionShaped({
      "squeal.config.json": json({
        nodeTest: [
          { name: "test:package", cwd: "packages/cezar", include: ["test/e2e/*.test.ts"] },
        ],
      }),
    });
    const { code, stdout } = await setup(root, ["--yes", "--no-warmup"]);
    expect(code).toBe(0);
    expect(stdout).toContain('(vitest.exclude and nodeTest "test:package" exclude)?');
    expect(config(root)).toMatchObject({
      vitest: { exclude: ["packages/cezar/test/e2e/**"] },
      nodeTest: [{ name: "test:package", exclude: ["test/e2e/**"] }],
    });
    expect((await setup(root, ["--check"])).code).toBe(0);
  });

  it("says where a node:test project not yet in the config takes it", async () => {
    const root = cezarionShaped({ "squeal.config.json": json({}) });
    const { code, stdout } = await setup(root, ["--yes", "--no-warmup"]);
    expect(code).toBe(0);
    expect(config(root).vitest).toEqual({ exclude: ["packages/cezar/test/e2e/**"] });
    expect(stdout).toContain(
      'squeal init: nodeTest project "test:package" is not in squeal.config.json; give it exclude ["test/e2e/**"] when you add it',
    );
  });

  it("wave 13 B1: a partial exclude gives a node:test project each path relative to its cwd", async () => {
    const root = cezarionShaped({
      "squeal.config.json": json({
        nodeTest: [
          { name: "test:package", cwd: "packages/cezar", include: ["test/e2e/*.test.ts"] },
        ],
      }),
      "packages/cezar/test/e2e/source.test.ts": "\n",
    });
    const [group] = (await buildPlan(root, { env: harnessEnv() })).slow.groups;
    expect(group?.exclude?.kept).toEqual(["packages/cezar/test/e2e/source.test.ts"]);
    const { io } = capture(root, harnessEnv(["claude"]));
    const code = await main(
      ["setup", "--yes", "--harness", "none", "--block", "none", "--no-warmup"],
      io,
    );
    expect(code).toBe(0);
    expect(config(root)).toMatchObject({
      vitest: {
        exclude: [
          "packages/cezar/test/e2e/package-cli.test.ts",
          "packages/cezar/test/e2e/update.test.ts",
        ],
      },
      nodeTest: [
        {
          name: "test:package",
          exclude: ["test/e2e/package-cli.test.ts", "test/e2e/update.test.ts"],
        },
      ],
      slow: { include: ["packages/cezar/test/e2e/**"] },
    });
  });
});
