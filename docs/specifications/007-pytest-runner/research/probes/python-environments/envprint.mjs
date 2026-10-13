// Throwaway: a Node-side environment fingerprint from files only, as a daemon could compute it.
// Usage: node envprint.mjs <venv dir>  -> JSON lines: inputs, and the ms it took.
import { readdirSync, readFileSync, readlinkSync, realpathSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
const venv = process.argv[2];
const t0 = process.hrtime.bigint();
const cfg = readFileSync(join(venv, "pyvenv.cfg"), "utf8");
const home = /^home\s*=\s*(.*)$/m.exec(cfg)[1].trim();
const lib = readdirSync(join(venv, "lib")).find((d) => d.startsWith("python"));
const sp = join(venv, "lib", lib, "site-packages");
const entries = readdirSync(sp).sort();
const dists = [], pth = [], editables = [];
for (const e of entries) {
  if (e.endsWith(".dist-info")) {
    dists.push(e);
    const du = join(sp, e, "direct_url.json");
    if (existsSync(du)) editables.push([e, readFileSync(du, "utf8")]);
  } else if (e.endsWith(".pth")) pth.push([e, readFileSync(join(sp, e), "utf8")]);
}
const inputs = { pyvenvCfg: cfg, interpreter: realpathSync(join(venv, "bin", "python")), homeReal: realpathSync(home), dists, pth, editables };
const hash = createHash("sha256").update(JSON.stringify(inputs)).digest("hex").slice(0, 16);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(JSON.stringify({ hash, ms: +ms.toFixed(2), dists: dists.length, pth: pth.map((p) => p[0]), interpreter: inputs.interpreter, homeReal: inputs.homeReal }));
