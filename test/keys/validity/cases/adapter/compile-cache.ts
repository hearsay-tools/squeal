import type { Case } from "../../case.js";

/*
 * Spec 025 D7.2 (row 025-07): a daemon a Squeal launcher started carries
 * Squeal's own compile cache, `SQUEAL_OWN_COMPILE_CACHE=1`, and each runner
 * takes it out of its test processes' environment. One plain run per adapter
 * under it: what the runs store stays as without it, and the lines that take
 * the cache out run.
 */

const lines = (...text: string[]) => `${text.join("\n")}\n`;

export const OWN_COMPILE_CACHE: readonly Case[] = [
  {
    kind: "adapter:vitest",
    name: "a run under Squeal's own compile cache",
    why: "025 D7.2: Vitest's workers start without the daemon's own compile cache, which decides no outcome",
    ownCompileCache: true,
    input: {
      files: {
        "package.json": '{ "name": "validity-cache", "private": true, "type": "module" }\n',
        "vitest.config.ts": 'export default { test: { include: ["test/**/*.test.ts"] } };\n',
        "test/pass.test.ts": lines('import { it } from "vitest";', 'it("passes", () => {});'),
      },
      runs: [{ files: [{ project: "", path: "test/pass.test.ts" }], touched: [] }],
    },
  },
  {
    kind: "adapter:node-test",
    name: "a run under Squeal's own compile cache",
    why: "025 D7.2: node:test's children start without the daemon's own compile cache, which decides no outcome",
    ownCompileCache: true,
    input: {
      files: {
        "package.json": `${JSON.stringify({ name: "validity", type: "module" })}\n`,
        "test/pass.test.mjs": lines(
          'import { test } from "node:test";',
          'test("passes", () => {});',
        ),
      },
      runs: [{ files: ["test/pass.test.mjs"] }],
    },
  },
  {
    kind: "adapter:pytest",
    name: "a run under Squeal's own compile cache, Python 3.13",
    why: "025 D7.2: pytest's run environment leaves out the daemon's own compile cache, which decides no outcome",
    ownCompileCache: true,
    input: {
      python: "3.13",
      files: {
        "pyproject.toml": lines("[tool.pytest.ini_options]", 'testpaths = ["tests"]'),
        "tests/test_pass.py": lines("def test_pass():", "    assert True"),
      },
      runs: [{ files: ["tests/test_pass.py"] }],
    },
  },
];
