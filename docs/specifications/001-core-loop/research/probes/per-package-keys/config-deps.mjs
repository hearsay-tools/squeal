// Throwaway probe (001-102): what Vite reports as the config file's dependencies.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const { createVitest } = await import(pathToFileURL(createRequire(process.cwd() + "/package.json").resolve("vitest/node")).href);
const vitest = await createVitest("test", { watch: false });
for (const p of vitest.projects) console.log(p.name || "(root)", "configFileDependencies:", p.vite.config.configFileDependencies.map((f) => f.replace(process.cwd(), "")), "plugins:", p.vite.config.plugins.map((x) => x.name).filter((n) => !n.startsWith("vite:") && !n.startsWith("vitest")));
await vitest.close();
