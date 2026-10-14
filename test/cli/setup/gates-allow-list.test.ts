import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rewordGates, scanGates } from "../../../src/cli/setup/gates.js";
import { git } from "../../hash/git-repo.js";
import { cleanupFixtures, squealShaped, VITEST_GATE } from "./fixture.js";

/*
 * Row 005-55, review 005-54 (`reviews/wave-7.md`): a gate is a line whose
 * sentence opens with an instruction to run the test command; every other
 * line naming it is a mention, and its id is refused for rewording.
 */

afterEach(cleanupFixtures);

const FALLBACK = (command: string) =>
  ` If it exits 3 at its deadline, run it again; if it exits 3 for another reason, \`squeal\` is unavailable, or you doubt its result, run \`${command}\` instead.`;
const CHECKPOINT = "`squeal run --all --wait 110000`";

const tracked = (root: string) => git(root, ["ls-files"]).trim().split("\n");

/** Each fixture is a git repository built by git processes: past 5 s under load (task 001-320). */
const FIXTURES = { timeout: 30_000 } as const;

/** The `AGENTS.md` holding `lines`: its gates' proposals, by line, and its mentions' lines. */
function scan(lines: readonly string[]) {
  const root = squealShaped({ "AGENTS.md": `${lines.join("\n")}\n` });
  const found = scanGates(root, tracked(root), { nodeTest: true });
  return {
    root,
    gates: found.gates.filter((g) => g.file === "AGENTS.md").map((g) => [g.line, g.proposed]),
    mentions: found.mentions.filter((m) => m.file === "AGENTS.md").map((m) => m.line),
  };
}

/** Asks to reword every line of `lines`, one at a time: each is refused and the file stays as it was. */
function refusesEach(lines: readonly string[]): void {
  const { root } = scan(lines);
  const before = readFileSync(join(root, "AGENTS.md"), "utf8");
  for (const line of lines.keys()) {
    const id = `AGENTS.md:${line + 1}`;
    expect(rewordGates(root, tracked(root), [id], { nodeTest: true })).toEqual({
      refused: `no gate line ${id}`,
    });
  }
  expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(before);
}

describe("the review's blockers (005-54 B1 to B3)", FIXTURES, () => {
  it("B1: lists a line describing the command as a mention, and refuses it", () => {
    const lines = [
      "The `npm test` command runs the unit suite.",
      "Our `npx vitest run` script is the fast gate.",
    ];
    expect(scan(lines)).toMatchObject({ gates: [], mentions: [1, 2] });
    refusesEach(lines);
  });

  it("B2: lists negation across a wrap or before e.g. as a mention, and refuses it", () => {
    const lines = [
      "Do not run the whole suite,",
      "including `npm test`.",
      "",
      "Do not run tests manually (e.g. via `npm test`).",
      "",
      "Before you finish, do not",
      "run `npm test`.",
      "",
      "Run the linter only, i.e. not `npm test`.",
    ];
    expect(scan(lines)).toMatchObject({ gates: [], mentions: [2, 4, 7, 9] });
    refusesEach(lines);
  });

  it("B3: puts the fallback after the sentence's real end, past e.g. and parentheses", () => {
    const { root, gates } = scan([
      "Run `npm test` before finishing (e.g. after code review).",
      "",
      "Run `npx vitest run` (i.e. the unit suite, etc. as needed). Paste the output in your final message.",
    ]);
    const first = `Run ${CHECKPOINT} before finishing (e.g. after code review).${FALLBACK("npm test")}`;
    const third = `Run ${CHECKPOINT} (i.e. the unit suite, etc. as needed).${FALLBACK("npx vitest run")} Paste the output in your final message.`;
    expect(gates).toEqual([
      [1, first],
      [3, third],
    ]);
    expect(
      rewordGates(root, tracked(root), ["AGENTS.md:1", "AGENTS.md:3"], { nodeTest: true }),
    ).toEqual({ written: ["AGENTS.md:1", "AGENTS.md:3"] });
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(`${first}\n\n${third}\n`);
  });
});

describe("instructions still reworded exactly", FIXTURES, () => {
  it("rewords D5's first example, a plain gate, and one after an unrelated negation", () => {
    const { gates, mentions } = scan([
      VITEST_GATE,
      "",
      "Run `npm test` before you finish.",
      "",
      "Do not commit generated files. Run `npm test` before you finish.",
    ]);
    expect(mentions).toEqual([]);
    expect(gates).toEqual([
      [
        1,
        `Verification: \`npm run lint\`, \`npm run typecheck\`, \`npm run build\`, and ${CHECKPOINT}.${FALLBACK("npx vitest run")} Paste the output in your final message.`,
      ],
      [3, `Run ${CHECKPOINT} before you finish.${FALLBACK("npm test")}`],
      [
        5,
        `Do not commit generated files. Run ${CHECKPOINT} before you finish.${FALLBACK("npm test")}`,
      ],
    ]);
  });

  it("takes each opener, after a list marker, emphasis or a short label", () => {
    const { gates, mentions } = scan([
      "- **Always run `npm test` before committing.**",
      "1. Use `npm test` to check your change.",
      "Execute `npm test` once you are done.",
      "Verify with `npm test` before you push.",
      "**Testing:** run `npm test` before you finish.",
      "Same prompt within each matrix: run exactly `npm test`, no edits.",
      "Make sure to run `npm test`.",
      "Use of `npm test` is discouraged.",
      "Run-time of `npm test` is three minutes.",
    ]);
    expect(gates.map(([line]) => line)).toEqual([1, 2, 3, 4, 5]);
    // A label longer than two words is prose (corpus 56), an unlisted opener or a noun a mention.
    expect(mentions).toEqual([6, 7, 8, 9]);
  });
});

/*
 * Ten of the review's 80 corpus proposals, verbatim: under the allow-list,
 * the two instructions are reworded exactly and the rest are mentions. The
 * probe over all 80 gave 4 true instructions reworded and 76 mentions.
 */
const CORPUS_MENTIONS = [
  // 2: docs/specifications/001-core-loop/research/claude-code-integration.md:71
  '  The label says "Stop hook" whatever the source event. The woken agent acted on its own: it ran `npx vitest run` and `git status` before replying.',
  // 29: docs/specifications/002-codex-adapter/research/codex-sessions-and-wake.md:93
  "- No primer: the agent ran `npm test` twice.",
  // 40: docs/specifications/003-node-test-runner/tasks/003-37/notes.md:16
  "The `node --test` parent process records too (`graph-<i>-<pid>` of its own): only the `--require` preloads, no `--import` (argv or `NODE_OPTIONS`).",
  // 56: docs/specifications/005-agent-adoption/research/hook-levers.md:45
  "**Verified by experiment.** Same prompt within each matrix: run exactly `npx vitest run`, no edits, report what actually ran. Warm one-file fixture except Stop's deliberate `lookup-only` setup. These counts exclude the failed Codex binary-copy pilot and permission/filter probes. The two pre/post subjects per harness and earlier Codex allow/deny subjects had the setup caveat documented in the probe README.",
  // 63: docs/specifications/005-agent-adoption/spec.md:51
  "- `1`: it completed with known failures, as `npx vitest run` exits on a failure.",
  // 68: docs/specifications/005-agent-adoption/tasks/wave-6.md:118
  "- One `npx vitest run --maxWorkers=4`.",
  // 69: docs/specifications/005-agent-adoption/tasks/wave-7.md:38
  '- A plain gate such as "Run `npm test` before you finish." is still reworded.',
  // 75: docs/specifications/006-model-evals/tasks/wave-11.md:23
  "- `npm run lint`, `npm run typecheck` and `npx vitest run test/evals` pass.",
] as const;

describe("a sample of the review's corpus", FIXTURES, () => {
  it("lists descriptions and reports as mentions", () => {
    for (const line of CORPUS_MENTIONS) {
      expect(scan([line]), line).toMatchObject({ gates: [], mentions: [1] });
    }
  });

  it("rewords its true instructions exactly", () => {
    const { gates } = scan([
      // 60: docs/specifications/005-agent-adoption/research/probes/instruction-surfaces/conditions/c.md:3
      "Before you finish, run `npx vitest run` and paste its output in your final message.",
      "",
      // 70: docs/specifications/005-agent-adoption/tasks/wave-7.md:62
      "- Run one full `npx vitest run --maxWorkers=4`.",
    ]);
    expect(gates).toEqual([
      [
        1,
        `Before you finish, run ${CHECKPOINT} and paste its output in your final message.${FALLBACK("npx vitest run")}`,
      ],
      [3, `- Run one full ${CHECKPOINT}.${FALLBACK("npx vitest run --maxWorkers=4")}`],
    ]);
  });
});
