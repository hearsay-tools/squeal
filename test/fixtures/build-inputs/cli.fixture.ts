import { expect, it } from "vitest";
import { suiteCli } from "../../daemon/helpers.js";

// Row 011-141 (`test/helpers/build-inputs.test.ts`): builds the CLI in `beforeAll`, as the daemon tests do.
const built = suiteCli();

it("builds the CLI", () => {
  expect(built().cli).toMatch(/dist\/cli\/index\.js$/);
});
