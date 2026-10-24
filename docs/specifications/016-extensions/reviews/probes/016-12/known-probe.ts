import { play, accepted } from "./test/kit/driver.js";
import { fakePack } from "./test/kit/fake.js";
import { K1 } from "./test/kit/scenarios/k1-flip.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const scratch = mkdtempSync(join(tmpdir(), "known-probe-"));
try {
 const broken = { ...fakePack({ known: { K1: "documented stale outcome after edit" } }), open: async () => { throw new Error("unrelated adapter start failure"); } };
 const result = await play(K1, broken, scratch);
 console.log(JSON.stringify({verdict: result.verdict, accepted: accepted(result.verdict), lines: result.lines}));
} finally { rmSync(scratch, {recursive:true,force:true}); }
