import { appendFileSync } from "node:fs";
const log = process.env.PROBE_AFTER;
process.on("exit", () => {
  if (log && globalThis.__sqLoaded !== undefined) appendFileSync(log, `${performance.now() - globalThis.__sqLoaded}\n`);
});
