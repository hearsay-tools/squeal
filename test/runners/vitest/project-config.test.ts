import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { environmentHash } from "../../../src/core/keys/environment.js";
import type { RunnerEnvironment } from "../../../src/core/types/index.js";
import { openFixture, SLOW } from "./helpers.js";

/*
 * Row 011-88 (task 011-85 R2, regression 5; 011 C3, the environment hash):
 * a project's environment holds the root's config file, its own and the
 * `configFileDependencies` of these two, never a sibling's. Vitest loads each
 * `projects` entry as its own config, so a sibling's file changes no option
 * this project receives.
 */

/** The environment hash `keying.ts` takes, with fixed core inputs and the fixture's own bytes. */
function digest(root: string, env: RunnerEnvironment): string {
  const core = {
    squealVersion: "0",
    nodeVersion: "0",
    platform: "p",
    arch: "a",
    installedDependencies: "",
    env: {},
  };
  return environmentHash(core, env, (path) => {
    try {
      return createHash("sha256")
        .update(readFileSync(join(root, path)))
        .digest("hex");
    } catch {
      return null;
    }
  });
}

const E2E = (extra: string) => `import { defineConfig } from "vitest/config";
import { shared } from "../shared.config.ts";
import { options } from "./options.ts";
${extra}
export default defineConfig({
  test: { name: "e2e", include: ["*.e2e.test.ts"], globalSetup: ["./boot.ts"], ...shared, ...options },
});
`;
const ROOT = (extra: string) => `import { defineConfig } from "vitest/config";
import { shared } from "./shared.config.ts";
${extra}
export default defineConfig({
  test: {
    projects: [
      { test: { name: "server", include: ["test/server.test.ts"] } },
      { test: { name: "web", include: ["test/web.test.ts"] } },
      "e2e/vitest.config.ts",
    ],
    ...shared,
  },
});
`;

describe("each Vitest project's config files (011-88)", () => {
  it.each([
    ["e2e/vitest.config.ts", "only e2e", E2E("// edited"), ["e2e"]],
    ["e2e/options.ts", "only e2e", "export const options = {}; // edited\n", ["e2e"]],
    ["vitest.config.ts", "every project", ROOT("// edited"), ["e2e", "server", "web"]],
    [
      "shared.config.ts",
      "each project whose config imports it",
      "export const shared = {}; // edited\n",
      ["e2e", "server", "web"],
    ],
  ])("an edit of %s re-keys %s", SLOW, async (path, _which, text, moved) => {
    const fx = await openFixture("five-projects", {
      "shared.config.ts": "export const shared = {};\n",
      "vitest.config.ts": ROOT(""),
      "e2e/vitest.config.ts": E2E(""),
      "e2e/options.ts": "export const options = {};\n",
    });
    const hashes = async () =>
      new Map((await fx.adapter.environment()).map((env) => [env.project, digest(fx.root, env)]));
    const before = await hashes();
    fx.write(path, text);
    await fx.adapter.invalidate([{ path, kind: "change" }]);
    const after = await hashes();
    expect([...after.keys()].sort()).toEqual(["e2e", "server", "web"]);
    const changed = [...after].filter(([project, hash]) => before.get(project) !== hash);
    expect(changed.map(([project]) => project).sort()).toEqual(moved);
  });
});
