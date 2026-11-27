import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { StatusResult } from "../../src/core/types/status.js";
import { buildDist } from "../../src/harness/build.js";
import { CLAUDE_CODE_PLUGIN } from "../../src/harness/claude-code/build.js";
import {
  createFixtureRepo,
  type FixtureRepo,
  SLOW,
  spawnCli,
  stopStrays,
  waitFor,
  waitReady,
} from "../daemon/helpers.js";
import { testBuildDir } from "../daemon/strays.js";
import { TEST_VERSION } from "../fixed-version.js";
import { observeMetafile } from "../helpers/build-inputs.js";
import { recorded } from "./helpers.js";
import {
  type CountedRun,
  countEnded,
  listed,
  runCounted,
  type Work,
} from "./work-per-call-helpers.js";

/*
 * Row 025-28 (`research/hook-slowdown.md`, 3): the work of each Claude Code
 * hook and of `squeal status`, counted as SQL statements and sync file calls
 * per call against a real daemon. The same work takes different time on
 * different machines; the count does not, so more work per call fails here
 * on any machine, and the test asserts no time. A count below its limit
 * passes and asks for the limit to be lowered.
 *
 * The hooks, `status` and the daemon run from a plugin build of the sources,
 * as users run them, so an edit to a hook counts before `dist` is rebuilt.
 * The store holds a small project's results like `latency.test.ts`'s: 50
 * test files of 10 checks beside the scheduler fixture's 5, every one passing
 * after one full run, with the default config and its complexity count done.
 * Then PreToolUse, PostToolBatch and `status` run the statements the research
 * counted on the benchmark's 500-file project at 0.1.653 (61, 117 and 69).
 * The file calls leave out the ones Node's own code makes
 * (`work-counter.mjs`), 2 per call of the research's counts.
 */

/** Generated test files beside the fixture's, and checks in each. */
const FILES = 50;
const CHECKS_PER_FILE = 10;

/**
 * The most work each call may do: SQL statements and sync file calls, counted
 * at 0.1.655. Lower a limit when the test says the count fell; raise it only
 * for work the change means to add.
 */
const LIMITS: Readonly<Record<string, { readonly sql: number; readonly files: number }>> = {
  "session-start": { sql: 182, files: 29 },
  "user-prompt-submit": { sql: 114, files: 15 },
  "pre-tool-use (Edit)": { sql: 61, files: 12 },
  "post-tool-batch (Read)": { sql: 117, files: 14 },
  stop: { sql: 146, files: 16 },
  "stop-slow": { sql: 0, files: 5 },
  "waiter (-p)": { sql: 0, files: 4 },
  status: { sql: 69, files: 20 },
  "status --json": { sql: 69, files: 20 },
  "session-end": { sql: 68, files: 15 },
};

/** Each test's fixture, its daemons stopped and its files removed after the test. */
const repos: FixtureRepo[] = [];
afterEach(async () => {
  for (const repo of repos.splice(0)) {
    await stopStrays(repo.root);
    repo.cleanup();
  }
}, SLOW.timeout);

function generated(): Record<string, string> {
  const files: Record<string, string> = {};
  for (let f = 0; f < FILES; f++) {
    const cases = Array.from(
      { length: CHECKS_PER_FILE },
      (_, c) => `it("case ${c}", () => {\n  expect(${f} + ${c}).toBe(${f + c});\n});\n`,
    );
    files[`test/m${f}.test.ts`] = `import { expect, it } from "vitest";\n\n${cases.join("\n")}`;
  }
  // The defaults users run with, not the daemon tests' `CODE_OFF`.
  files["squeal.config.json"] = "{}\n";
  return files;
}

/** The plugin build: under the test run's directory, so the teardown finds a daemon left running. */
let built = "";
let dist = "";
beforeAll(async () => {
  built = testBuildDir(expect.getState().testPath);
  dist = join(built, "dist");
  observeMetafile(await buildDist(CLAUDE_CODE_PLUGIN, dist, TEST_VERSION));
}, SLOW.timeout);
afterAll(() => rmSync(built, { recursive: true, force: true }), SLOW.timeout);

describe("work per hook and status call against a real daemon", () => {
  it(
    "stays within the committed SQL statement and file call limits",
    async ({ annotate }) => {
      const repo = createFixtureRepo({ files: generated() });
      repos.push(repo);
      const cli = (args: readonly string[]) =>
        spawnCli(join(dist, "cli/squeal.mjs"), args, { cwd: repo.root, env: repo.env });
      const start = cli(["start"]);
      expect((await start.exited).code, start.stderr()).toBe(0);
      await waitReady(repo);
      const all = cli(["run", "--all", "--wait"]);
      const ran = await all.exited;
      expect(ran.code, `${all.stdout()}${all.stderr()}`).toBe(0);
      // A complexity count still running changes what the hooks read: count after it ends.
      await waitFor(
        async () => {
          const shown = cli(["status", "--json"]);
          expect((await shown.exited).code, shown.stderr()).toBe(0);
          // The generated files at least: the fixture's few are admitted in the same scan.
          return countEnded(JSON.parse(shown.stdout()) as StatusResult, FILES);
        },
        60_000,
        "the complexity count",
      );

      // Only what a hook reads from Claude Code and the system: no developer config or HOME.
      const home = join(repo.runtimeDir, "home");
      mkdirSync(home, { recursive: true });
      const env = {
        PATH: process.env.PATH ?? "",
        HOME: home,
        XDG_RUNTIME_DIR: repo.runtimeDir,
        XDG_CONFIG_HOME: join(repo.runtimeDir, "config"),
        CLAUDE_PROJECT_DIR: repo.root,
        CLAUDE_CODE_SESSION_ATTENDED: "1",
        CLAUDE_CODE_ENTRYPOINT: "cli",
      };
      const NODE_ARGS = ["--disable-warning=ExperimentalWarning"];
      const hook = (name: string, input: string, overrides: object = {}, extra = {}) =>
        runCounted(
          [...NODE_ARGS, join(dist, `${name}.mjs`)],
          recorded(input, repo.root, overrides),
          { ...env, ...extra },
          repo.root,
        );
      const status = (...args: string[]) =>
        runCounted(
          [...NODE_ARGS, join(dist, "cli/squeal.mjs"), "status", ...args],
          "",
          env,
          repo.root,
        );
      const edited = join(repo.root, "src/math.ts");

      // One turn, in Claude Code's order, each call once.
      const calls: [string, () => Promise<CountedRun>, (run: CountedRun) => void][] = [
        ["session-start", () => hook("session-start", "session-start"), () => {}],
        ["user-prompt-submit", () => hook("user-prompt-submit", "user-prompt-submit"), silent],
        [
          "pre-tool-use (Edit)",
          () =>
            hook("pre-tool-use", "pre-tool-use", {
              tool_input: { file_path: edited, old_string: "a + b", new_string: "a - b" },
            }),
          silent,
        ],
        [
          "post-tool-batch (Read)",
          () =>
            hook("post-tool-batch", "post-tool-batch", {
              tool_calls: [
                {
                  tool_name: "Read",
                  tool_input: { file_path: edited },
                  tool_use_id: "toolu_01R",
                  tool_output: "",
                  tool_output_error: false,
                },
              ],
            }),
          silent,
        ],
        ["stop", () => hook("stop", "stop"), silent],
        ["stop-slow", () => hook("stop-slow", "stop"), silent],
        [
          "waiter (-p)",
          () =>
            hook(
              "waiter",
              "stop",
              {},
              { CLAUDE_CODE_SESSION_ATTENDED: "0", CLAUDE_CODE_ENTRYPOINT: "sdk-cli" },
            ),
          silent,
        ],
        ["status", () => status(), () => {}],
        ["status --json", () => status("--json"), () => {}],
        ["session-end", () => hook("session-end", "session-end"), silent],
      ];

      const counted: { call: string; work: Work }[] = [];
      for (const [call, run, check] of calls) {
        const out = await run();
        expect(out.code, `${call}: ${out.stdout}${out.stderr}`).toBe(0);
        check(out);
        counted.push({ call, work: out.work });
      }

      // Shown with a pass too: Vitest prints a passing test's annotations, not its console.
      await annotate(
        counted.map(({ call, work }) => `${call}: ${work.sql} SQL, ${work.files} files`).join("; "),
      );
      for (const { call, work } of counted) {
        const limit = LIMITS[call];
        expect(limit, `${call}: no limit`).toBeDefined();
        if (limit === undefined) continue;
        expect(work.processes, `${call}: wrote no counts`).toBeGreaterThan(0);
        expect
          .soft(work.sql, `${call}: SQL statements over the limit\n${listed(work.bySql)}`)
          .toBeLessThanOrEqual(limit.sql);
        expect
          .soft(work.files, `${call}: file calls over the limit\n${listed(work.byFile)}`)
          .toBeLessThanOrEqual(limit.files);
        if (work.sql < limit.sql || work.files < limit.files) {
          await annotate(
            `${call}: ${work.sql} SQL statements (limit ${limit.sql}), ${work.files} file calls ` +
              `(limit ${limit.files}): the work fell; lower its limit in work-per-call.test.ts`,
            "notice",
          );
        }
      }
    },
    SLOW.timeout,
  );
});

/** The call delivered nothing: the quiet path this count is for. */
function silent(run: CountedRun): void {
  expect(run.stdout, run.stderr).toBe("");
}
