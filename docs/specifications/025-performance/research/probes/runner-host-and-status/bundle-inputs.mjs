// Throwaway probe for research 025-12 (D12): which source folders fill each scratch bundle.
//   node bundle-inputs.mjs <outdir>/meta.json
// Prints, per output, its bytes and the top source folders by bytes in that output.
import { readFileSync } from "node:fs";

const meta = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const [file, out] of Object.entries(meta.outputs)) {
  const byDir = new Map();
  for (const [input, { bytesInOutput }] of Object.entries(out.inputs)) {
    const parts = input.replace(/^.*node_modules\/\.pnpm\/[^/]+\/node_modules\//, "node_modules/").split("/");
    const dir = parts[0] === "node_modules" ? parts.slice(0, parts[1]?.startsWith("@") ? 3 : 2).join("/") : parts.slice(0, 3).join("/");
    byDir.set(dir, (byDir.get(dir) ?? 0) + bytesInOutput);
  }
  const top = [...byDir].sort((a, b) => b[1] - a[1]).slice(0, 14);
  console.log(`${file} ${out.bytes} bytes`);
  for (const [dir, bytes] of top) console.log(`  ${String(bytes).padStart(9)}  ${dir}`);
}
