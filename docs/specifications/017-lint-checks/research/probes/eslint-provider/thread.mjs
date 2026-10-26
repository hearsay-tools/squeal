// Throwaway probe (017-01). For the changes a new ESLint instance did not pick
// up in warm.mjs: does a new worker thread in the same process pick them up?
// Usage: node thread.mjs <project root>
import { Worker } from "node:worker_threads";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { mutations } from "./mutations.mjs";

const root = process.argv[2];
const FILES = ["src/a.js", "src/b.js", "src/u.ts", "src/t.ts"];
const start = async () => {
  const w = new Worker(new URL("./worker.mjs", import.meta.url), { workerData: { root }, env: { ...process.env, KEPT_ONLY: "1" } });
  await new Promise((ok) => w.once("message", ok));
  return w;
};
const lint = (w) => new Promise((ok) => { w.once("message", (m) => ok(norm(m.kept))); w.postMessage({ id: 0, files: FILES }); });
const norm = (rs) => JSON.stringify(rs.map((r) => [r.file.replace(root + "/", ""), r.messages]).sort());
const cli = () => {
  const r = spawnSync("node", [join(root, "node_modules/eslint/bin/eslint.js"), "-f", "json", ...FILES], { cwd: root, encoding: "utf8" });
  return norm(JSON.parse(r.stdout).map((x) => ({ file: x.filePath, messages: x.messages.map((m) => `${m.ruleId}|${m.message}`).sort() })));
};

const old = await start();
await lint(old);
for (const m of mutations(root).filter((m) => ["config-import", "local-rule-code", "shareable-config", "plugin-code", "tsconfig"].includes(m.id))) {
  m.apply();
  try {
    const truth = cli();
    const fresh = await start();
    console.log(`${m.id.padEnd(18)} old thread equals CLI: ${(await lint(old)) === truth}  new thread equals CLI: ${(await lint(fresh)) === truth}`);
    await fresh.terminate();
  } finally {
    m.revert();
  }
}
await old.terminate();
