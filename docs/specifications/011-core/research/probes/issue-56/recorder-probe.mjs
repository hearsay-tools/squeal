// Throwaway probe for hearsay-tools/squeal#56. Not product code.
// Loads a shipped recorder.cjs as `--require` into a parent process that plays a
// Vitest worker's test file, which runs `node --input-type=module --eval "import ... from '<file URL>'"`
// through execFileSync, as cezarion's pi-default-tools.test.ts does. Three cases:
// the script missing, then created, then edited. Prints what the recorder kept per case.
// Writes only under a fresh /tmp/squeal-issue56-* directory, removed at the end.
// Usage: node recorder-probe.mjs <plugin dir, e.g. ~/.claude/plugins/cache/hearsay/squeal/0.1.231>
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const recorder = join(process.argv[2], "dist", "observe", "recorder.cjs");
const root = mkdtempSync(join(tmpdir(), "squeal-issue56-"));
const testFile = join(root, "src", "pi-default-tools.test.mjs");
const script = join(root, "scripts", "pi-default-tools.mjs");
mkdirSync(join(root, "src"));
mkdirSync(join(root, "scripts"));
writeFileSync(testFile, "// stands for the test file\n");

// The "test file": what pi-default-tools.test.ts does, run inside the observed parent.
const body = `
const { execFileSync } = require("node:child_process");
const url = ${JSON.stringify(pathToFileURL(script).href)};
try {
  const out = execFileSync(process.execPath, ["--input-type=module", "--eval",
    "import register from '" + url + "'; console.log(typeof register);"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  console.log("child ok:", out.trim());
} catch (e) {
  console.log("child failed:", String(e.message).split("\\n")[0]);
}`;

function run(label) {
  const out = join(root, `out-${label}`);
  mkdirSync(out);
  const settings = { out, root, skip: [], file: testFile };
  const result = execFileSync(process.execPath, ["--require", recorder, "-e", body], {
    env: { ...process.env, SQUEAL_OBSERVE: JSON.stringify(settings), NODE_OPTIONS: "" },
    encoding: "utf8",
  });
  const kept = { f: new Set(), l: new Set(), r: new Set(), w: new Set() };
  for (const name of readdirSync(out)) {
    for (const line of readFileSync(join(out, name), "utf8").split("\n").filter(Boolean)) {
      const entry = JSON.parse(line);
      for (const k of Object.keys(kept)) for (const p of entry[k] ?? []) kept[k].add(p.replace(root, "<root>") + `  (for ${entry.t.replace(root, "<root>")})`);
    }
  }
  console.log(`--- ${label}`);
  console.log(result.trim());
  for (const k of Object.keys(kept)) console.log(`  ${k}: ${kept[k].size === 0 ? "(none)" : [...kept[k]].join("; ")}`);
}

try {
  run("1-missing");
  writeFileSync(script, "export default function register() {}\n");
  run("2-created");
  writeFileSync(script, "export default function register() { return 1; }\n");
  run("3-edited");
} finally {
  rmSync(root, { recursive: true, force: true });
}
