// 011-149 probe (throwaway): import specifiers with a version query in one file's output through one Vitest project.
// Usage: node vq.mjs <clone> <project> <path>
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [clone, name, path] = process.argv.slice(2);
const req = createRequire(join(clone, "package.json"));
const { createVitest } = await import(pathToFileURL(req.resolve("vitest/node")).href);
const vitest = await createVitest("test", { watch: false, reporters: [], project: [name] }, { server: { watch: null } });
const project = vitest.projects[0];
console.log("environment:", project.config.environment);
const env = ["jsdom", "happy-dom"].includes(project.config.environment) ? project.vite.environments.client : project.vite.environments.ssr;
const code = (await env.transformRequest(join(clone, path))).code;
console.log(code.split("\n").filter((l) => /import|__vi_ssr_import__/.test(l)).slice(0, 8).map((l) => l.slice(0, 220)).join("\n"));
await vitest.close(); process.exit(0);
