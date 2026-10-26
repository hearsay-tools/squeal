// prints each model request of a fake-openai log: step, message count, last messages
const fs = require("fs");
const n = Number(process.argv[3] || 3), w = Number(process.argv[4] || 900);
for (const l of fs.readFileSync(process.argv[2], "utf8").trim().split("\n")) {
  const r = JSON.parse(l); const m = r.body.messages || [];
  console.log(r.at, "step", r.step, r.url, "msgs", m.length, "tools", (r.body.tools || []).length);
  for (const x of m.slice(-n)) console.log("  ", x.role, JSON.stringify(x.content ?? x.tool_calls).slice(0, w));
}
