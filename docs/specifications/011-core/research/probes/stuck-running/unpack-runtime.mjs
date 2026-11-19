// Unpacks a Squeal release's squeal-codex-runtime.json.gz into a directory.
// Usage: node unpack-runtime.mjs <runtime.json.gz> <target-dir>
// Throwaway probe helper for research row 011-394.
import { gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
const [archive, target] = process.argv.slice(2);
const bundle = JSON.parse(gunzipSync(readFileSync(archive)).toString("utf8"));
for (const f of bundle.files) {
  const out = join(target, f.path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(f.data, "base64"));
  chmodSync(out, f.mode);
}
console.log(`unpacked ${bundle.files.length} files of ${bundle.version} into ${target}`);
