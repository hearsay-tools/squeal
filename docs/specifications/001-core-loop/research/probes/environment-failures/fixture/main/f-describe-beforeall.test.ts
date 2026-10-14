// A beforeAll inside a describe: the error belongs to the suite, not the module.
import { beforeAll, describe, expect, test } from "vitest";
describe("group", () => {
  beforeAll(() => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
  });
  test("inside", () => expect(1).toBe(1));
});
test("outside", () => expect(1).toBe(1));
