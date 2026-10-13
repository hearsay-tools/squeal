import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { blockText } from "../../../src/cli/setup/block.js";
import { GATE_WAIT_MS, reword, rewordGates, scanGates } from "../../../src/cli/setup/gates.js";
import { buildPlan } from "../../../src/cli/setup/plan.js";
import { git } from "../../hash/git-repo.js";
import { cleanupFixtures, harnessEnv, squealShaped, VITEST_GATE } from "./fixture.js";

/* Spec 005 D5, row 005-12: gate lines found, reworded on their own yes, mentions only listed. */

afterEach(cleanupFixtures);

const FALLBACK = (command: string) =>
  ` If it exits 3 at its deadline, run it again; if it exits 3 for another reason, \`squeal\` is unavailable, or you doubt its result, run \`${command}\` instead.`;

const tracked = (root: string) => git(root, ["ls-files"]).trim().split("\n");

describe("gate detection", () => {
  it("lists this repository's old gate with its rewording, and the skill's line as a mention", async () => {
    const root = squealShaped();
    const plan = await buildPlan(root, { env: harnessEnv() });
    expect(plan.gates).toEqual([
      {
        id: "CLAUDE.md:3",
        file: "CLAUDE.md",
        line: 3,
        text: VITEST_GATE,
        command: "npx vitest run",
        proposed: `Verification: \`npm run lint\`, \`npm run typecheck\`, \`npm run build\`, and \`squeal run --all --wait 110000\`. Paste the output in your final message.${FALLBACK("npx vitest run")}`,
        reason: null,
      },
    ]);
    // AGENTS.md -> CLAUDE.md is one file: its gate is listed once.
    expect(plan.mentions).toEqual([
      {
        file: ".claude/skills/worker/SKILL.md",
        line: 1,
        text: "Run `npx vitest run` and paste it.",
      },
    ]);
  });

  it("finds each test command D5 names, and node --test only with node:test projects", () => {
    const root = squealShaped({
      "AGENTS.md": [
        "Run npm test before you commit.",
        "Run `npm run test` too.",
        "Then `vitest run --coverage`.",
        "Not `npm run test:e2e`, `npm run lint` or `pnpm vitest`.",
        "And `node --import tsx --test test/*.test.ts`.",
        "",
      ].join("\n"),
    });
    const commands = (nodeTest: boolean) =>
      scanGates(root, tracked(root), { nodeTest })
        .gates.filter((g) => g.file === "AGENTS.md")
        .map((g) => g.command);
    expect(commands(false)).toEqual(["npm test", "npm run test", "vitest run --coverage"]);
    expect(commands(true)).toEqual([
      "npm test",
      "npm run test",
      "vitest run --coverage",
      "node --import tsx --test test/*.test.ts",
    ]);
  });

  it("skips the Squeal block and lines already reworded; a fenced line is not offered", () => {
    const root = squealShaped({
      "CLAUDE.md": [
        "Run `squeal run --all --wait`; run `npx vitest run` when it cannot answer.",
        "```sh",
        "npx vitest run",
        "```",
        "",
        blockText(),
      ].join("\n"),
    });
    expect(scanGates(root, tracked(root), { nodeTest: false }).gates).toEqual([
      {
        id: "CLAUDE.md:3",
        file: "CLAUDE.md",
        line: 3,
        text: "npx vitest run",
        command: "npx vitest run",
        proposed: null,
        reason: "inside a code block",
      },
    ]);
  });

  it("offers no rewording for a command that runs more than the test command", () => {
    const root = squealShaped({
      "AGENTS.md": [
        "Run `npm run lint && npx vitest run && npm run build`.",
        "Run `npm run lint; npm test`.",
        "Run `npx vitest run && npx vitest run --project e2e`.",
        "Run `npm test` and then `npx vitest run --project e2e`.",
        "Run `CI=1 npx vitest run`.",
        "Run `env NODE_OPTIONS=--inspect npm test`.",
        "Run `npm test | tee test.log`.",
        "Run CI=1 npm test before you commit.",
        "Run npm run lint && npm test before you commit.",
        "",
      ].join("\n"),
    });
    const gates = scanGates(root, tracked(root), { nodeTest: false }).gates.filter(
      (g) => g.file === "AGENTS.md",
    );
    expect(gates.map((g) => [g.line, g.proposed])).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((line) => [line, null]),
    );
    expect(gates.map((g) => g.reason)).toEqual([
      "runs more than the test command: `npm run lint && npx vitest run && npm run build`",
      "runs more than the test command: `npm run lint; npm test`",
      "runs the test command more than once",
      "runs the test command more than once",
      "runs more than the test command: `CI=1 npx vitest run`",
      "runs more than the test command: `env NODE_OPTIONS=--inspect npm test`",
      "runs more than the test command: `npm test | tee test.log`",
      "runs more than the test command: `Run CI=1 npm test before you commit.`",
      "runs more than the test command: `Run npm run lint && npm test before you commit.`",
    ]);
  });

  it("still rewords a test command with flags, beside other commands in their own spans", () => {
    const root = squealShaped({
      "AGENTS.md": "Run `npm run lint && npm run build`, then `vitest run --reporter=dot`.\n",
    });
    const [gate] = scanGates(root, tracked(root), { nodeTest: false }).gates.filter(
      (g) => g.file === "AGENTS.md",
    );
    expect(gate?.reason).toBeNull();
    expect(gate?.proposed).toBe(
      `Run \`npm run lint && npm run build\`, then \`squeal run --all --wait 110000\`.${FALLBACK("vitest run --reporter=dot")}`,
    );
  });

  it("rewords a bare command and keeps the rest of the line", () => {
    expect(GATE_WAIT_MS).toBe(110_000);
    expect(reword("- Run npm test and paste its output")).toBe(
      `- Run squeal run --all --wait 110000 and paste its output.${FALLBACK("npm test")}`,
    );
  });
});

describe("rewording gate lines", () => {
  it("writes only the lines named, through the symlink, and refuses an unknown id", () => {
    const root = squealShaped({
      "CLAUDE.md": `# Agents\n\n${VITEST_GATE}\n\nAlso run \`npm test\`.\n`,
    });
    const files = tracked(root);
    expect(rewordGates(root, files, ["AGENTS.md:3"], { nodeTest: false })).toEqual({
      refused: "no gate line AGENTS.md:3",
    });
    expect(rewordGates(root, files, ["CLAUDE.md:5"], { nodeTest: false })).toEqual({
      written: ["CLAUDE.md:5"],
    });
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(
      `# Agents\n\n${VITEST_GATE}\n\nAlso run \`squeal run --all --wait 110000\`.${FALLBACK("npm test")}\n`,
    );
    // Reworded, the line is no longer a gate; the one kept still is.
    expect(scanGates(root, files, { nodeTest: false }).gates.map((g) => g.id)).toEqual([
      "CLAUDE.md:3",
    ]);
  });

  it("refuses a fenced line and writes nothing", () => {
    const root = squealShaped({ "CLAUDE.md": "```\nnpm test\n```\n\nRun `npm test`.\n" });
    const before = readFileSync(join(root, "CLAUDE.md"), "utf8");
    expect(
      rewordGates(root, tracked(root), ["CLAUDE.md:5", "CLAUDE.md:2"], { nodeTest: false }),
    ).toEqual({ refused: "CLAUDE.md:2: inside a code block" });
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(before);
  });

  it("refuses a compound command and writes nothing", () => {
    const root = squealShaped({
      "CLAUDE.md": "Run `npm test`.\nRun `npm run lint && npx vitest run && npm run build`.\n",
    });
    const before = readFileSync(join(root, "CLAUDE.md"), "utf8");
    expect(
      rewordGates(root, tracked(root), ["CLAUDE.md:1", "CLAUDE.md:2"], { nodeTest: false }),
    ).toEqual({
      refused:
        "CLAUDE.md:2: runs more than the test command: `npm run lint && npx vitest run && npm run build`",
    });
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(before);
  });
});
