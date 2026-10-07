import { expect, it } from "vitest";

// Review wave-11d S3: a project helper loaded by a relative `require`, which loads a package.
declare const require: (id: string) => { value: string };

it("reads a package through a relatively required helper", () => {
  expect(require("./helper.cjs").value).toBe("one");
});
