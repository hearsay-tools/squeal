import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Stands in for what only `npm run test:e2e` can boot: leaves a mark when it runs. */
export default function setup(): void {
  writeFileSync(join(import.meta.dirname, "booted"), "");
}
