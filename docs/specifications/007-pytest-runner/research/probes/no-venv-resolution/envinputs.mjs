// Throwaway (007-04) Q3: the spec 007 D2 environment-hash inputs of one environment, each as a sha256,
// so two environments can be compared input by input. node envinputs.mjs <venv>
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const venv = fs.realpathSync(process.argv[2]);
const h = (b) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 12);
const lib = path.join(venv, "lib"); const py = fs.readdirSync(lib).find((d) => d.startsWith("python"));
const site = path.join(lib, py, "site-packages");
const names = fs.readdirSync(site).sort();
const out = { "interpreter realpath": fs.realpathSync(path.join(venv, "bin", "python")), "pyvenv.cfg": h(fs.readFileSync(path.join(venv, "pyvenv.cfg"))), "site-packages names": h(names.join("\n")) };
for (const n of names.filter((n) => n.endsWith(".pth"))) out[`pth ${n}`] = h(fs.readFileSync(path.join(site, n)));
for (const n of names.filter((n) => n.endsWith(".dist-info"))) {
  const d = path.join(site, n, "direct_url.json");
  if (fs.existsSync(d)) out[`direct_url ${n}`] = h(fs.readFileSync(d));
}
console.log(JSON.stringify(out, null, 1));
