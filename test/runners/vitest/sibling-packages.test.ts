import { describe, expect, it } from "vitest";
import { openFixture, SLOW } from "./helpers.js";

/*
 * Task 011-85 R2 (011 C3, C14): a project's environment packages come from
 * the root's config file and its own, never a sibling's, as its files do
 * (`project-config.test.ts`). Review 0.1.253 B1: a sibling config's builtin
 * once made every project's environment opaque.
 */

/** `e2e/vitest.config.ts` of `five-projects`, after `head`. */
const e2eConfig = (head: string) =>
  `${head}export default {\n` +
  '  test: { name: "e2e", include: ["*.e2e.test.ts"], globalSetup: ["./boot.ts"] },\n};\n';

describe("each Vitest project's environment packages (011-85 R2)", () => {
  it("hold a config's builtin for its own project only", SLOW, async () => {
    const head = 'import "node:child_process";\nimport "vitest/config";\n';
    const fx = await openFixture("five-projects", { "e2e/vitest.config.ts": e2eConfig(head) });
    const envs = await fx.adapter.environment();
    expect(envs.map((e) => e.project)).toEqual(["api-client", "contract", "e2e", "server", "web"]);
    for (const env of envs) {
      expect([env.project, env.packages?.builtins.includes("child_process")]).toEqual([
        env.project,
        env.project === "e2e",
      ]);
    }
  });
});
