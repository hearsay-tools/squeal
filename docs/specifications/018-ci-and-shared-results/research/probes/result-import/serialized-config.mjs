// Throwaway (topic result-import): print Vitest's serializedConfig for a project, as Squeal's adapter reads it.
// Run with cwd = a fixture clone: node serialized-config.mjs <fixture>
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const root = process.argv[2];
const req = createRequire(`${root}/package.json`);
const { createVitest } = await import(pathToFileURL(req.resolve("vitest/node")).href);
const vitest = await createVitest("test", { watch: false, run: true, root }, {}, {});
const project = vitest.projects[0];
const { sequence, ...rest } = project.serializedConfig;
const { seed, ...seq } = sequence;
console.log(JSON.stringify({ ...rest, sequence: seq }, null, 1));
await vitest.close();
