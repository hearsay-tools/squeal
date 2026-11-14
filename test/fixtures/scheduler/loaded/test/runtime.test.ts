import { expect, test } from "vitest";

test("loads a module by a name no import names", async () => {
  // A name built at run time: no import graph, glob or literal names the module.
  const spec = ["..", "src", `${["la", "zy"].join("")}.ts`].join("/");
  const loaded = (await import(/* @vite-ignore */ spec)) as { value: number };
  expect(loaded.value).toBe(1);
});
