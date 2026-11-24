// Probe 023-81: adds a log line per listing hash, run acknowledgement, listing move and store
// decision to a copy of the built CLI (plugins/claude-code/dist/cli/squeal.mjs) in a scratch
// clone. Never on a branch. Lines go to $SQUEAL_PROBE_LOG as JSON. usage: node instrument.cjs <squeal.mjs>
const fs = require("node:fs");
const f = process.argv[2];
let s = fs.readFileSync(f, "utf8");
const L = `(globalThis.__probe ??= (o) => { try { require("node:fs").appendFileSync(process.env.SQUEAL_PROBE_LOG, JSON.stringify({ t: Date.now(), pid: process.pid, ...o }) + "\\n"); } catch {} })`;
const rep = (a, b) => {
  if (!s.includes(a)) throw new Error(`missing ${a.slice(0, 60)}`);
  s = s.replace(a, b);
};
rep(
  `        const disk = this.#namesOnDisk(directory);\n        this.#seen.set(directory, markerOr(disk));`,
  `        const disk = this.#namesOnDisk(directory);\n        ${L}({ ev: "hashOf", dir: directory, disk });\n        this.#seen.set(directory, markerOr(disk));`,
);
rep(
  `      ran(directories) {\n        for (const directory of directories) {`,
  `      ran(directories) {\n        ${L}({ ev: "ran", dirs: directories });\n        for (const directory of directories) {`,
);
rep(
  `          this.#seen.set(directory, hash4);\n          moved4.add(listingPath(directory));`,
  `          this.#seen.set(directory, hash4);\n          ${L}({ ev: "apply-moved", dir: directory, disk: this.#namesOnDisk(directory) });\n          moved4.add(listingPath(directory));`,
);
rep(
  `  const decision = storeDecision(entry4, record2.end, ledger.files.get(file.id) === file);\n  if (decision.kind === "superseded") {`,
  `  const decision = storeDecision(entry4, record2.end, ledger.files.get(file.id) === file);\n  ${L}({ ev: "record", file: file.ref.path, key: String(key3).slice(0, 12), now: String(file.key).slice(0, 12), kind: decision.kind, at: decision.at, paths: (decision.paths ?? []).slice(0, 12), firstSeen: (record2.end.growth?.get(file.id)?.firstSeen ?? []).slice(0, 12) });\n  if (decision.kind === "superseded") {`,
);
fs.writeFileSync(f, s);
