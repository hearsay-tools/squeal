// Throwaway: copy stdin lines to stdout as {"t": ms since start, ...line}.
import { createInterface } from "node:readline";
const t0 = Number(process.argv[2] ?? Date.now());
for await (const line of createInterface({ input: process.stdin })) {
  let v; try { v = JSON.parse(line); } catch { v = { raw: line }; }
  process.stdout.write(JSON.stringify({ t: Date.now() - t0, ...v }) + "\n");
}
