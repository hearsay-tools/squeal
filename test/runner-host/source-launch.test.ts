import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { squealVersion } from "../../src/core/daemon/version.js";
import { createHostedVitest } from "../../src/core/runner-host/vitest-host.js";
import { ALL_TEST_FILES, openFixture, SLOW } from "../runners/vitest/helpers.js";

/*
 * Spec 021 D8 (row 021-11, review 0.1.434 B6): the host runs under the
 * daemon's own Node arguments. A daemon started from the sources, `node
 * --import tsx src/cli/index.ts daemon <root>` as `test/integration/
 * node-test.test.ts` starts one, needs its loader in the host too: without
 * it, `src/cli/index.ts` cannot import its `.js` specifiers and Vitest never
 * starts.
 */

const REPO = resolve(import.meta.dirname, "../..");
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

describe("a runner host started from the sources", SLOW, () => {
  it("runs under the launch's loader and lists the fixture's test files", async () => {
    const project = await openFixture("basic", {}, (root) =>
      createHostedVitest(
        {
          execPath: process.execPath,
          execArgv: ["--import", TSX],
          cli: join(REPO, "src/cli/index.ts"),
        },
        squealVersion(),
        { root },
      ),
    );
    expect((await project.adapter.testFiles()).map((f) => f.path)).toEqual(ALL_TEST_FILES);
  });
});
