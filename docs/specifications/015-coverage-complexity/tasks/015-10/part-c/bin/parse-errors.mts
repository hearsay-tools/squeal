// Throwaway probe for 015-10 Part C. Not product code.
//   tsx parse-errors.mts <file>...   prints each file's error ranges and the text at them
import { readFileSync } from "node:fs";
import { countFile } from "../counter/src/core/code/count/index.ts";
for (const path of process.argv.slice(2)) {
  const text = readFileSync(path, "utf8");
  const { functions, errors } = await countFile(text, "typescript");
  console.log(`${path}: ${functions.length} functions, errors ${JSON.stringify(errors)}`);
  const lines = text.split("\n");
  for (const e of errors as any[]) {
    const start = (e.startLine ?? e.start?.line ?? e.line ?? 1) - 1;
    console.log(lines.slice(Math.max(0, start - 1), start + 2).map((l, i) => `  ${start + i}: ${l}`).join("\n"));
  }
}
