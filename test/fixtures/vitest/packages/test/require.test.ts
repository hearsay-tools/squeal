import { expect, it } from "vitest";

// Review wave-11b B2: Vitest's module runner gives every module a `require`, so
// this loads a package without any import Vite sees.
declare const require: (id: string) => { cjsValue: string };

it("loads a package through a bare require", () => {
  expect(require("cjs-pkg").cjsValue).toMatch(/^cjs-/);
});
