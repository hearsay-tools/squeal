import { expect, it } from "vitest";
import { tscObserved } from "../../helpers/build-inputs.js";

// Review 0.1.277 B2 (`test/helpers/build-inputs.test.ts`): a compile that fails with a diagnostic
// longer than a file name can be still stats what `tsc` listed, then throws the compile error.
it("throws the compile error", () => {
  let thrown: unknown;
  try {
    tscObserved(["-p", "test/fixtures/build-inputs/broken/tsconfig.json"]);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ stdout: expect.stringContaining("error TS2741") });
});
