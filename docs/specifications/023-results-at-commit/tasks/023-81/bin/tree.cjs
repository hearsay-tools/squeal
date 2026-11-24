// Probe 023-81: every directory's entry names under <root>, skipping node_modules and .git contents, as JSON.
const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const root = process.argv[2];
const out = {};
(function walk(rel) {
  let ents;
  try { ents = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return; }
  out[rel === "" ? "./" : rel + "/"] = ents.map((e) => e.name).sort();
  for (const e of ents) if (e.isDirectory() && e.name !== "node_modules" && e.name !== ".git") walk(rel === "" ? e.name : `${rel}/${e.name}`);
})("");
process.stdout.write(JSON.stringify(out));
