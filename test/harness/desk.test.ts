import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { frontDeskScript } from "../../src/core/daemon/desk.js";
import { tempDir } from "../store/helpers.js";

/*
 * Review wave 3, B1: the plugin's CLI bundle is dist/cli/squeal.mjs and its
 * socket worker dist/cli/front-desk.mjs; the `tsc` build has
 * dist/core/daemon/front-desk.js beside desk.js.
 */
describe("frontDeskScript", () => {
  it("finds the tsc worker beside the module", () => {
    const dir = tempDir("squeal-desk-");
    writeFileSync(join(dir, "front-desk.js"), "");
    expect(frontDeskScript(pathToFileURL(join(dir, "desk.js")))).toBe(join(dir, "front-desk.js"));
  });

  it("finds the bundled worker beside the CLI bundle", () => {
    const dir = tempDir("squeal-desk-");
    writeFileSync(join(dir, "front-desk.mjs"), "");
    expect(frontDeskScript(pathToFileURL(join(dir, "squeal.mjs")))).toBe(
      join(dir, "front-desk.mjs"),
    );
  });

  it("is null when neither exists, as when run from the TypeScript sources", () => {
    const dir = tempDir("squeal-desk-");
    expect(frontDeskScript(pathToFileURL(join(dir, "desk.ts")))).toBeNull();
  });
});
