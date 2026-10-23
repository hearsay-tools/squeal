import { mkdtempSync, rmSync } from "node:fs";
import { buildOpencodeDistObserved } from "../bundle-helpers.js";

/** The OpenCode package's `dist/` built into a temp dir, as `npm run build:plugin` builds it. */
export async function buildOpencodeBundles(): Promise<{ dir: string; cleanup: () => void }> {
  const dir = mkdtempSync("/tmp/sq-oc-");
  await buildOpencodeDistObserved(dir);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
