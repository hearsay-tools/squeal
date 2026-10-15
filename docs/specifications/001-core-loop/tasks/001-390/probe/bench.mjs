// usage: node bench.mjs <node> <runs>
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const [node, runs] = [process.argv[2], Number(process.argv[3] ?? 40)];
const P = process.env.P, rec = `${P}/rec/recorder.cjs`;
const settings = JSON.stringify({ out: `${P}/fx/out`, root: `${P}/fx/root`, skip: [], file: `${P}/fx/root/t.test.js` });
const modes = {
  none: {},
  require: { NODE_OPTIONS: `--require ${JSON.stringify(rec)}`, SQUEAL_OBSERVE: settings },
  import: { NODE_OPTIONS: `--import ${JSON.stringify(pathToFileURL(rec).href)}`, SQUEAL_OBSERVE: settings },
};
const times = Object.fromEntries(Object.keys(modes).map((m) => [m, []]));
for (let i = 0; i < runs; i++) for (const [m, env] of Object.entries(modes)) {
  const t = process.hrtime.bigint();
  const r = spawnSync(node, [`${P}/fx/root/child.cjs`], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, cwd: `${P}/fx/root` });
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  if (r.status !== 0) { console.log(m, "exit", r.status, String(r.stderr).slice(0, 300)); break; }
  times[m].push(ms);
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1); };
for (const [m, a] of Object.entries(times)) if (a.length) console.log(node.split("/").slice(-3).join("/"), m, "n", a.length, "p50", q(a, 0.5), "p90", q(a, 0.9));
