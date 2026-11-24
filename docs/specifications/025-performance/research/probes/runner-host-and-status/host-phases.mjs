import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const [S, root, n] = process.argv.slice(2);
const load = () => readFileSync("/proc/loadavg", "utf8").split(" ")[0];
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.floor(s.length / 2)]); };
const env = { ...process.env, NODE_COMPILE_CACHE: `${S}/cc`, SQUEAL_OWN_COMPILE_CACHE: "1" };
delete env.NODE_USE_ENV_PROXY;
for (const bundle of ["status-timed", "squeal-timed"]) for (const form of [["status"], ["status", "--json"]]) {
  const rows = []; const l0 = load(); const wall = [];
  for (let i = 0; i < Number(n) + 2; i++) {
    const t0 = performance.now();
    const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", `${S}/plugin/dist/cli/${bundle}.mjs`, ...form], { cwd: root, env, encoding: "utf8", maxBuffer: 64 << 20 });
    const ms = performance.now() - t0;
    if (i < 2) continue;
    wall.push(ms);
    rows.push(JSON.parse(r.stderr.trim().split("\n").filter((x) => x.startsWith('{"imported"')).at(-1)));
  }
  console.log(JSON.stringify({ bundle, form: form.join(" "), n: rows.length, wall: med(wall), imported: med(rows.map((r) => r.imported)), read: med(rows.map((r) => r.read1 - r.read0)), format: med(rows.map((r) => r.out - r.read1)), done: med(rows.map((r) => r.done)), load1: `${l0}->${load()}` }));
}
