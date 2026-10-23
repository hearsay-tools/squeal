import { mkdtempSync, rmSync } from "node:fs";
import { buildDist } from "../../../src/harness/build.js";
import { PI_PLUGIN } from "../../../src/harness/pi/build.js";
import { observeMetafile } from "../../helpers/build-inputs.js";

/** The Pi package's `dist/` built into a temp dir, as `npm run build:plugin` builds it. */
export async function buildPiBundles(): Promise<{ dir: string; cleanup: () => void }> {
  const dir = mkdtempSync("/tmp/sq-pi-");
  observeMetafile(await buildDist(PI_PLUGIN, dir));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
