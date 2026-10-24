import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { coverageOn, coverageProvider } from "../../../src/core/code/coverage/index.js";
import { DEFAULT_POLICY } from "../../../src/core/types/index.js";
import { tempDir } from "../../store/helpers.js";
import { ON } from "../helpers.js";

describe("the coverage provider's place and policy (015 D1, D8)", () => {
  it("is found in a plugin's dist/coverage/ from its bundled CLI, and beside the sources", () => {
    const plugin = tempDir("sq-provider-");
    mkdirSync(join(plugin, "dist", "coverage"), { recursive: true });
    writeFileSync(join(plugin, "dist", "coverage", "provider.mjs"), "export default {};\n");

    expect(coverageProvider(pathToFileURL(join(plugin, "dist", "cli", "squeal.mjs")))).toBe(
      join(plugin, "dist", "coverage", "provider.mjs"),
    );
    expect(coverageProvider(pathToFileURL(join(plugin, "elsewhere", "x.mjs")))).toBeNull();
    expect(coverageProvider()).toMatch(/src\/core\/code\/coverage\/provider\.mjs$/);
  });

  it("is on only with complexity on too (D1)", () => {
    const coverage = { enabled: true };
    expect(coverageOn({ ...ON, coverage })).toBe(true);
    expect(coverageOn({ ...DEFAULT_POLICY, coverage })).toBe(false);
    expect(coverageOn(ON)).toBe(false);
  });
});
