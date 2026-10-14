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

/** Each fixture is a git repository built by git processes: past 5 s under load (task 001-320). */
const FIXTURES = { timeout: 30_000 } as const;

describe("gate detection", FIXTURES, () => {
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
        // Row 005-47: the fallback follows the checkpoint's sentence, the gate's last stays last.
        proposed: `Verification: \`npm run lint\`, \`npm run typecheck\`, \`npm run build\`, and \`squeal run --all --wait 110000\`.${FALLBACK("npx vitest run")} Paste the output in your final message.`,
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

  it("rewords a plain gate, and a bold one without breaking its emphasis", () => {
    expect(reword("Run `npm test` before you finish.")).toBe(
      `Run \`squeal run --all --wait 110000\` before you finish.${FALLBACK("npm test")}`,
    );
    expect(reword("**Run `npm test` before you finish.**")).toBe(
      `**Run \`squeal run --all --wait 110000\` before you finish.**${FALLBACK("npm test")}`,
    );
  });

  it("rewords a bare command and keeps the rest of the line", () => {
    expect(GATE_WAIT_MS).toBe(110_000);
    expect(reword("- Run npm test and paste its output")).toBe(
      `- Run squeal run --all --wait 110000 and paste its output.${FALLBACK("npm test")}`,
    );
  });
});

describe("rewording gate lines", FIXTURES, () => {
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

/*
 * Row 005-47, from cezar (`5dbb4b09:AGENTS.md`, `lessons.md` proposed row 2):
 * `--yes` inverted line 185 and broke its sentence, and appended the
 * fallback mid-paragraph or after a table row on the other four.
 */
const CEZAR = {
  172: "| Cockpit e2e specs (`packages/web/e2e/*.e2e.ts`, the browser seam, a flaky shard) | `packages/web/e2e/README.md`, then `packages/web/e2e/agent-browser.ts` and `packages/web/e2e/contrast.ts` | Wait, then read, as one step: `click`/`hover`/`fill` auto-wait for their selector, `waitForValue` polls an expression and returns the sample that passed (hearsay-tools/cezarion#409); a one-shot `expect(browser.…)` right after an action is a race. `packages/web/src/test/e2e-wait-discipline.test.ts` scans every spec on `npm test` against a baseline that only shrinks. A red shard leaves a failure bundle (`.ai/qa/failures/`); read it before theorizing, and no flake fix lands without one or a local reproduction. |",
  185: "Do not duplicate those background runs with `npm test`,",
  201: "browser is an error in a Squeal run. `npm test` and `npm run test:watch` select",
  237: "`npm test` and `npm run test:unit` are the fast unit gate: no server, no browser. They must stay that way. `npm run test:package` needs a completed `npm run build` (it packs the tarball). Pull request CI runs packaged CLI E2E and cockpit browser E2E as separate checks; the required aggregate fails if the cockpit suite is skipped or failed.",
  326: "| Verification | Local: Squeal when installed and validating, otherwise focused npm checks. Full gate in CI: `npm run typecheck`, `npm test`, `npm run test:unit`, `npm run build`, `npm run test:package`, `npm run test:e2e` |",
} as const;

describe("lines that are no gate, or cannot take the fallback (row 005-47)", FIXTURES, () => {
  const scan = (lines: readonly string[]) => {
    const root = squealShaped({ "AGENTS.md": `${lines.join("\n")}\n` });
    const found = scanGates(root, tracked(root), { nodeTest: false });
    return {
      gates: found.gates.filter((g) => g.file === "AGENTS.md"),
      mentions: found.mentions.filter((m) => m.file === "AGENTS.md").map((m) => m.line),
    };
  };

  it("proposes none of cezar's five lines, and lists those naming Squeal or negated as mentions", () => {
    const { gates, mentions } = scan([
      CEZAR[172],
      "",
      CEZAR[185],
      "`npm run test:unit`, `npm run test:package`, `npm run test:e2e`, or `npm run test:changed`.",
      "",
      CEZAR[201],
      "only the four unit projects.",
      "",
      CEZAR[237],
      "",
      CEZAR[326],
    ]);
    expect(mentions).toEqual([3, 6, 11]);
    expect(gates.map((g) => [g.line, g.proposed, g.reason])).toEqual([
      [1, null, "a table row"],
      [9, null, "its sentence describes the test command rather than running it"],
    ]);
  });

  it("would not reword 185, 201 or 326 even without Squeal's name or the negation", () => {
    const { gates } = scan([
      "Duplicate those background runs with `npm test`,",
      "`npm run test:unit` too.",
      "",
      "Then `npm test` and `npm run test:watch` select",
      "only the four unit projects.",
      "",
      CEZAR[326].replace("Squeal", "a watcher"),
    ]);
    expect(gates.map((g) => [g.line, g.reason])).toEqual([
      [1, "its sentence goes on past the line"],
      [4, "its sentence goes on past the line"],
      [7, "a table row"],
    ]);
  });

  it("lists every negated line as a mention, but not a negation in an earlier sentence", () => {
    const { gates, mentions } = scan([
      "Never run `npx vitest run` by hand.",
      "Don't use `npm test` here.",
      "Avoid `npm test` in hooks.",
      "Use the editor's runner instead of `npm test`.",
      "Do not commit generated files. Run `npm test` before you finish.",
    ]);
    expect(mentions).toEqual([1, 2, 3, 4]);
    expect(gates.map((g) => [g.line, g.reason])).toEqual([[5, null]]);
  });

  it("lists this repository's own gate line, which names Squeal, as a mention only", () => {
    const line = readFileSync(join(import.meta.dirname, "../../../CLAUDE.md"), "utf8")
      .split("\n")
      .find((l) => l.startsWith("Verification:")) as string;
    expect(line).toContain("`npx vitest run`");
    expect(scan([line]).gates).toEqual([]);
    expect(
      scan([line.replace("squeal run --all --wait", "squeal status --wait")]).mentions,
    ).toEqual([1]);
  });

  // The cost of the subject rule, accepted by the coordinator: reported, never reworded wrongly.
  it("reports a gate whose sentence opens with the command", () => {
    const { gates } = scan([
      "`npm test` must pass before you finish.",
      "- `npx vitest run` is the gate.",
    ]);
    expect(gates.map((g) => [g.line, g.proposed, g.reason])).toEqual([
      [1, null, "its sentence describes the test command rather than running it"],
      [2, null, "its sentence describes the test command rather than running it"],
    ]);
  });

  it("appends to a list item that ends its paragraph, and refuses one that goes on", () => {
    const { gates } = scan([
      "- Run `npm test` before committing",
      "- Lint",
      "",
      "Run `npm test` and",
      "paste it.",
    ]);
    expect(gates.map((g) => [g.line, g.proposed, g.reason])).toEqual([
      [
        1,
        `- Run \`squeal run --all --wait 110000\` before committing.${FALLBACK("npm test")}`,
        null,
      ],
      [4, null, "its sentence goes on past the line"],
    ]);
  });
});
