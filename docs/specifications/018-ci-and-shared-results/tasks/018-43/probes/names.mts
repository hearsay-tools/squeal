// Throwaway (row 018-43): the exported check names that carry a line, from a results bundle.
import { readFileSync } from "node:fs";
import { decodeBundle } from "/home/agent/projects/squeal/.ai/cezar/worktrees/37809bc6-27de-49d9-8d04-79dd3264b3f6/src/core/store/transfer-bundle.ts";
const bundle = decodeBundle(readFileSync(process.argv[2] as string));
if (typeof bundle === "string") throw new Error(bundle);
for (const r of bundle.results) if (r.fullName?.includes("(line ")) console.log(r.fullName, r.location?.line);
