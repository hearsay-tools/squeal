// Throwaway (row 020-41): prefixes each stdin line with the seconds since this process started.
import { createInterface } from "node:readline";

const t0 = performance.now();
for await (const line of createInterface({ input: process.stdin })) {
  process.stdout.write(`[${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}
