// Throwaway: prints each variant's exact/trim/norm digest prefix.
import { readFileSync } from "node:fs";
import { digest, normalize } from "../strip.mjs";
for (const v of ["a", "b", "c", "d"]) {
  const r = await normalize(readFileSync(new URL(`./${v}.ts`, import.meta.url), "utf8"), ".ts");
  console.log(v, digest(".ts", r.exact).slice(0, 8), digest(".ts", r.trim).slice(0, 8), digest(".ts", r.norm).slice(0, 8));
}
