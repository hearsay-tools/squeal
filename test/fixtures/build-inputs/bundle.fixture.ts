import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildPiBundles } from "../../harness/pi/helpers.js";

// Row 011-141 (`test/helpers/build-inputs.test.ts`): builds the Pi bundles in `beforeAll`, as the Pi tests do.
let built: Awaited<ReturnType<typeof buildPiBundles>> | undefined;
beforeAll(async () => {
  built = await buildPiBundles();
}, 120_000);
afterAll(() => built?.cleanup());

it("builds the Pi bundles", () => {
  expect(existsSync(join(built?.dir ?? "", "cli/squeal.mjs"))).toBe(true);
});
