import { mkdtempSync, rmSync } from "node:fs";
import { buildOpencodeDist } from "../../../src/harness/opencode/build.js";
import { observeMetafile } from "../../helpers/build-inputs.js";

/** The OpenCode package's `dist/` built into a temp dir, as `npm run build:plugin` builds it. */
export async function buildOpencodeBundles(): Promise<{ dir: string; cleanup: () => void }> {
  const dir = mkdtempSync("/tmp/sq-oc-");
  observeMetafile(await buildOpencodeDist(dir));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
