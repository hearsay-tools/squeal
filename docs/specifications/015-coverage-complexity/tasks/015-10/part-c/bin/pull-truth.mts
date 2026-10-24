// Throwaway probe for 015-10 Part C. Not product code.
//   tsx pull-truth.mts <paths file>   for files/pull-before and files/pull-after: each function over
//   20 at either side, with its CC on both sides and whether its body hash moved
import { existsSync, readFileSync } from "node:fs";
import { countFile } from "../counter/src/core/code/count/index.ts";
const paths = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const key = (f: any) => `${f.qualifiedName ?? f.name}#${f.occurrence ?? 0}`;
for (const p of paths) {
  const side = async (dir: string) => {
    const f = `files/${dir}/${p}`;
    if (!existsSync(f)) return new Map();
    const { functions } = await countFile(readFileSync(f, "utf8"), "typescript");
    return new Map(functions.map((x: any) => [key(x), x]));
  };
  const b = await side("pull-before");
  const a = await side("pull-after");
  for (const k of new Set([...b.keys(), ...a.keys()])) {
    const x = b.get(k), y = a.get(k);
    const cb = x?.complexity, ca = y?.complexity;
    if ((cb ?? 0) > 20 || (ca ?? 0) > 20) {
      console.log(`${p} ${k} ${cb ?? "-"} -> ${ca ?? "-"} body ${x && y ? (x.bodyHash === y.bodyHash ? "same" : "moved") : "new/gone"}`);
    }
  }
}
