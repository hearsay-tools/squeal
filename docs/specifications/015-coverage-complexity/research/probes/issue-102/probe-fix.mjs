// As Squeal's adapter starts an instance (src/runners/vitest/adapter.ts #start):
// createVitest with the coverage CLI option, then a FIX applied to every Vite
// server before standalone(), then one run. Prints what a reporter receives.
// Usage: FIX=none|allow|safe CONFIG=<file> node probe-fix.mjs
import { createVitest } from "vitest/node";

const fix = process.env.FIX ?? "none";
const provider = process.env.PROVIDER;
const unhandled = [];
const modules = [];
const reporter = {
  onTestModuleEnd: (m) => modules.push(`${m.project.name || "(root)"}:${m.state()}`),
  onTestRunEnd: (_m, errors) => unhandled.push(...errors),
};
const vitest = await createVitest("test", {
  root: process.cwd(),
  config: process.env.CONFIG,
  watch: false,
  reporters: [reporter],
  coverage: { enabled: true, provider: "custom", customProviderModule: provider, reporter: [], reportsDirectory: process.env.REPORTS },
});
const servers = new Set([vitest.vite, ...vitest.projects.map((p) => p.vite)]);
for (const server of servers) {
  if (fix === "allow") server.config.server.fs.allow.push(provider);
  if (fix === "safe") server.config.safeModulePaths.add(provider);
}
await vitest.standalone();
await vitest.runTestSpecifications(await vitest.globTestSpecifications());
console.log(JSON.stringify({
  vitest: vitest.version,
  fix,
  frozen: [...servers].map((s) => Object.isFrozen(s.config.server.fs.allow)),
  modules,
  unhandled: unhandled.map((e) => ({
    message: e.message,
    VITEST_TEST_PATH: e.VITEST_TEST_PATH ?? null,
    stackHasCause: /Caused by|Cannot find module/.test(e.stack ?? ""),
    cause: e.cause ? { message: e.cause.message, code: e.cause.code } : null,
  })),
}, null, 1));
await vitest.close();
