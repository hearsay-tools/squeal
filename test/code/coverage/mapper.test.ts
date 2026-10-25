import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { mapWorkerScript } from "../../../src/core/code/coverage/mapper.js";
import { tempDir } from "../../store/helpers.js";

/*
 * Row 015-42: the plugin's CLI bundle is dist/cli/squeal.mjs and the
 * records' mapping worker dist/cli/coverage-map.mjs; the `tsc` build has
 * dist/core/code/coverage/map-worker.js beside mapper.js.
 */
describe("mapWorkerScript", () => {
  it("finds the tsc worker beside the module", () => {
    const dir = tempDir("squeal-map-");
    writeFileSync(join(dir, "map-worker.js"), "");
    expect(mapWorkerScript(pathToFileURL(join(dir, "mapper.js")))).toBe(join(dir, "map-worker.js"));
  });

  it("finds the bundled worker beside the CLI bundle", () => {
    const dir = tempDir("squeal-map-");
    writeFileSync(join(dir, "coverage-map.mjs"), "");
    expect(mapWorkerScript(pathToFileURL(join(dir, "squeal.mjs")))).toBe(
      join(dir, "coverage-map.mjs"),
    );
  });

  it("is null when neither exists, as when run from the TypeScript sources", () => {
    const dir = tempDir("squeal-map-");
    expect(mapWorkerScript(pathToFileURL(join(dir, "mapper.ts")))).toBeNull();
  });
});
