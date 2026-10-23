import { mkdtempSync, rmSync } from "node:fs";
import { PI_PLUGIN } from "../../../src/harness/pi/build.js";
import { buildDistObserved } from "../bundle-helpers.js";

/** The Pi package's `dist/` built into a temp dir, as `npm run build:plugin` builds it. */
export async function buildPiBundles(): Promise<{ dir: string; cleanup: () => void }> {
  const dir = mkdtempSync("/tmp/sq-pi-");
  await buildDistObserved(PI_PLUGIN, dir);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
