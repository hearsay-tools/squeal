// Throwaway: the same frames under Vitest's transform (oxc, source-mapped).
import { test } from "vitest";
test("frames", async () => {
  for (const v of ["a", "b", "c", "d"]) console.log("VITEST", v, (await import(`./${v}.ts`)).where({} as never));
});
