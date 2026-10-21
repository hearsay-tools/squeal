import { describe, expect, it } from "vitest";
import { openFixture, SLOW } from "./helpers.js";

/*
 * Row 011-90 (task 011-85 R4; 011 C3, C14): a project whose environment
 * files differ from the ones the definition before 011-85 hashed (every
 * project's config files) reports those as `formerFiles`, so a lookup can
 * read its rows stored under that definition as one.
 */
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

  it("reports none for a single project", SLOW, async () => {
    const fx = await openFixture("basic");
    const [env, ...rest] = await fx.adapter.environment();
    expect(rest).toEqual([]);
    expect(env?.files).toContain("vitest.config.ts");
    expect(env?.formerFiles).toBeUndefined();
  });
});
