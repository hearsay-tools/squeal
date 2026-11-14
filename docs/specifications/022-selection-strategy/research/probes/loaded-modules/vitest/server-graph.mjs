// Throwaway probe (spec 022 research, loaded-modules): what Vite's server-side
// module graph holds after a run, per environment. Uses the Vitest node API.
// Usage: node scripts/server-graph.mjs   (from $TMPDIR/lm-vitest)
import fs from "node:fs";
import path from "node:path";
import { SCRATCH, makeFixture } from "./lib.mjs";

const dir = path.join(SCRATCH, "server-graph");
makeFixture(dir, {
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["**/*.test.ts"] } });\n`,
  "flag.ts": "export const flag = false;\n",
  "heavy.ts": "export const r = 'heavy';\n",
  "dep.ts": "export const v = 'real';\n",
  "types.ts": "export interface T { a: number }\n",
  "a.test.ts": `import { test, expect, vi } from "vitest";\nimport type { T } from "./types";\nimport { flag } from "./flag";\nimport { v } from "./dep";\nvi.mock("./dep", () => ({ v: "m" }));\ntest("a", async () => { let r = "none"; if (flag) r = (await import("./heavy")).r; expect(r + v).toBe("nonem"); });\n`,
  "b.test.ts": `import { test, expect } from "vitest";\nimport { r } from "./heavy";\ntest("b", () => expect(r).toBe("heavy"));\n`,
});
process.chdir(dir);
process.env.HOME = path.join(SCRATCH, "home");
const { createVitest } = await import(path.join(dir, "node_modules/vitest/dist/node.js"));
const vitest = await createVitest("test", { watch: false, reporters: [] });
await vitest.start();
const rel = (p) => (p ? (p.startsWith(dir) ? p.slice(dir.length + 1) : p.replace(/.*node_modules\//, "<nm>/")) : p);
const out = {};
for (const project of vitest.projects) {
  for (const [name, env] of Object.entries(project.vite.environments)) {
    const nodes = [];
    for (const [id, m] of env.moduleGraph.idToModuleMap) {
      if (id.includes("/node_modules/")) continue;
      nodes.push({
        id: rel(id),
        transformed: !!m.transformResult,
        importers: [...m.importers].map((i) => rel(i.id)),
        imported: [...m.importedModules].map((i) => rel(i.id)),
      });
    }
    out[name] = nodes;
  }
}
await vitest.close();
fs.writeFileSync(path.join(SCRATCH, "results-server-graph.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
