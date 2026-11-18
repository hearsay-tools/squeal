// Throwaway probe for 023-10, run as squeal-e2e in clone s6 (squawk at 0dfe0724c). Not product code.
// The control's uncommitted bug: reportTitle drops everything after the first dot, so
// report-title.test.ts fails ('quarterly' for 'quarterly.results', '' for '.report').
import { readFileSync, writeFileSync } from "node:fs";

const file = "packages/contract/src/report-title.ts";
const before = readFileSync(file, "utf8");
const after = before.replace("artifact.name.replace(/(.+)\\.[^.]+$/, '$1')", "artifact.name.replace(/\\..*$/, '')");
if (after === before) throw new Error("the fixture edit did not apply");
writeFileSync(file, after);
