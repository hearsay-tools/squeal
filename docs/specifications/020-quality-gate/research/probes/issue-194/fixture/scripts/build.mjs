// The "pack" step: writes dist/stamp.json, which the packaged test requires. Used as the nodeTest entry's prepare.
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("dist", { recursive: true });
writeFileSync("dist/stamp.json", JSON.stringify({ built: true }));
