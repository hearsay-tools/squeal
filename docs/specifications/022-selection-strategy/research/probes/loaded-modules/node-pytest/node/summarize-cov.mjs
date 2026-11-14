// Throwaway: list fixture-relative script URLs in each NODE_V8_COVERAGE file.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const [dir, root] = process.argv.slice(2);
for (const name of readdirSync(dir).sort()) {
  const { result } = JSON.parse(readFileSync(`${dir}/${name}`, "utf8"));
  const files = result.map((s) => s.url).filter((u) => u.startsWith("file:")).map((u) => fileURLToPath(u)).filter((p) => p.startsWith(root + "/")).map((p) => p.slice(root.length + 1));
  console.log(`${name.replace(/-\d+\.json$/, "")} scripts=${result.length} project: ${[...new Set(files)].sort().join(" ")}`);
}
