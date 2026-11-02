import { expect, it } from "vitest";
import { compileObserved } from "../../helpers/build-inputs.js";

// Review 0.1.277 B2 (`test/helpers/build-inputs.test.ts`): a compile that fails with a diagnostic
// longer than a file name can be still stats what tsrs listed, then throws the compile error.
it("throws the compile error", () => {
  let thrown: unknown;
  try {
    compileObserved(["-p", "test/fixtures/build-inputs/broken/tsconfig.json"]);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ stdout: expect.stringContaining("error TS2741") });
});
