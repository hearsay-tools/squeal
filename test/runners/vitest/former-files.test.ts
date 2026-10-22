import { describe, expect, it } from "vitest";
import { openFixture, SLOW } from "./helpers.js";

/*
 * Row 011-90 (task 011-85 R4; 011 C3, C14): a project whose environment
 * files differ from the ones the definition before 011-85 hashed (every
 * project's config files) reports those as `formerFiles`, so a lookup can
 * read its rows stored under that definition as one. Review 0.1.253 B1: the
 * packages and builtins that definition read from them are `formerPackages`,
 * where they differ from the project's own.
 */

/** `e2e/vitest.config.ts` of `five-projects`, after `head`. */
const e2eConfig = (head: string) =>
  `${head}export default {\n` +
  '  test: { name: "e2e", include: ["*.e2e.test.ts"], globalSetup: ["./boot.ts"] },\n};\n';

describe("each Vitest project's former files (011-90)", () => {
  it("lists a sibling's config file where a project's own list lacks it", SLOW, async () => {
    const fx = await openFixture("five-projects");
    const envs = await fx.adapter.environment();
    expect(envs.map((e) => e.project)).toEqual(["api-client", "contract", "e2e", "server", "web"]);
    for (const env of envs) {
      if (env.project === "e2e") {
        expect(env.files).toContain("e2e/vitest.config.ts");
        expect(env.formerFiles).toBeUndefined();
      } else {
        expect(env.files).not.toContain("e2e/vitest.config.ts");
        expect(env.formerFiles).toEqual([...env.files, "e2e/vitest.config.ts"].sort());
      }
    }
  });

  it(
    "lists a sibling config's builtin and imports where a project's own lack them (review 0.1.253 B1)",
    SLOW,
    async () => {
      const head = 'import "node:child_process";\nimport "vitest/config";\n';
      const fx = await openFixture("five-projects", { "e2e/vitest.config.ts": e2eConfig(head) });
      for (const env of await fx.adapter.environment()) {
        if (env.project === "e2e") {
          expect(env.packages?.builtins).toContain("child_process");
          expect(env.formerPackages).toBeUndefined();
        } else {
          expect(env.packages?.builtins).not.toContain("child_process");
          expect(env.formerPackages?.builtins).toContain("child_process");
          expect(env.formerPackages?.imports).toContainEqual({ from: "e2e", name: "vitest" });
          expect(env.formerPackages?.runner).toContainEqual({ from: "e2e", name: "vitest" });
        }
      }
    },
  );

  it("reports no former packages where a sibling's config imports nothing", SLOW, async () => {
    const fx = await openFixture("five-projects", { "e2e/vitest.config.ts": e2eConfig("") });
    const envs = await fx.adapter.environment();
    expect(envs.filter((e) => e.formerFiles !== undefined)).toHaveLength(4);
    expect(envs.map((e) => e.formerPackages)).toEqual(envs.map(() => undefined));
  });

  it("reports none for a single project", SLOW, async () => {
    const fx = await openFixture("basic");
    const [env, ...rest] = await fx.adapter.environment();
    expect(rest).toEqual([]);
    expect(env?.files).toContain("vitest.config.ts");
    expect(env?.formerFiles).toBeUndefined();
    expect(env?.formerPackages).toBeUndefined();
  });
});
