// Throwaway probe for 011-127: writes option A into the scratch clone's squeal.config.json, `src/**/*.ts`
// for each test file the gap analysis found keyed short of its build. usage: node option-a.mjs <clone> <gap.json>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [clone, gap] = process.argv.slice(2);
const path = join(clone, "squeal.config.json");
const config = JSON.parse(readFileSync(path, "utf8"));
const files = JSON.parse(readFileSync(gap, "utf8")).filter((r) => r.missing > 0).map((r) => r.test);
for (const f of files) config.inputs[f] = [...new Set([...(config.inputs[f] ?? []), "src/**/*.ts"])];
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
console.log(`option A: ${files.length} entries`);
