// throwaway: which env values make std-env 4.3.0's isCI true
const dir = process.argv[2];
const m = await import(dir + "/node_modules/std-env/dist/index.mjs");
console.log(JSON.stringify({ CI: process.env.CI ?? null, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS ?? null, isCI: m.isCI, provider: m.provider, isAgent: m.isAgent, hasTTY: m.hasTTY }));
