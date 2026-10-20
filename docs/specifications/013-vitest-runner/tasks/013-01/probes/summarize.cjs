// Prints each probed path's graph modules and the test files their importer walk reaches.
const lines = require("fs").readFileSync(process.argv[2], "utf8").split("\n").filter((l) => l.startsWith("{"));
for (const l of lines) {
  const o = JSON.parse(l);
  if (!o.path) { console.log(l); continue; }
  const e = Object.entries(o.envs);
  if (!e.length) { console.log(o.path, "-> no module in any graph"); continue; }
  for (const [k, v] of e)
    console.log(o.path, k, "fileIndex:", JSON.stringify(v.testsReachedFromFileIndex), "everyModule:", JSON.stringify(v.testsReachedFromEveryModuleNamingIt),
      "\n    ", v.modules.map((m) => `${m.id}${m.transformed ? "[T]" : ""}${m.inFileIndex ? "" : "[notInFileIndex]"} <- ${m.importers.join(",")}`).join("\n     "));
}
