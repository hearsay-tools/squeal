// 011-149 probe (throwaway): one edit through one Vitest project's pipeline; prints the emitted lines that differ.
// Usage: node diffone.mjs <clone> <git dir> <project> <path> <old blob> <new blob>
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [clone, gitDir, name, path, oldH, newH] = process.argv.slice(2);
const req = createRequire(join(clone, "package.json"));
const { createVitest } = await import(pathToFileURL(req.resolve("vitest/node")).href);
const vitest = await createVitest("test", { watch: false, reporters: [], project: [name] }, { server: { watch: null } });
const project = vitest.projects[0], abs = join(clone, path);
const env = ["jsdom", "happy-dom"].includes(project.config.environment) ? project.vite.environments.client : project.vite.environments.ssr;
const codes = [];
for (const h of [oldH, newH]) {
  writeFileSync(abs, execFileSync("git", ["--git-dir", gitDir, "cat-file", "blob", h]));
  for (const m of env.moduleGraph.getModulesByFile(abs) ?? []) env.moduleGraph.invalidateModule(m);
  codes.push((await env.transformRequest(abs)).code.split("\n"));
}
const [a, b] = codes;
for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) console.log(i + 1, "\n- " + (a[i] ?? "").slice(0, 200) + "\n+ " + (b[i] ?? "").slice(0, 200));
await vitest.close(); execFileSync("git", ["-C", clone, "checkout", "--", path]); process.exit(0);
