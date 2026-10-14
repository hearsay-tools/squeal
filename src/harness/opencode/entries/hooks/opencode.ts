import { readFileSync } from "node:fs";
import { runBridge } from "../../bridge.js";

// The bridge (spec 008 D4), bundled as `dist/hooks/opencode.mjs`: one request on stdin.
let stdin = "";
try {
  stdin = readFileSync(0, "utf8");
} catch {
  // No readable stdin: no request, so no answer.
}
await runBridge(stdin, new URL(import.meta.url));
