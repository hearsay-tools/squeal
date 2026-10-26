// Throwaway probe (016-35). Prints a Cursor stream-json log without account
// fields: each event's type and subtype, assistant text, tool calls cut to
// 260 chars, and the result text. Keys matching email, key, token, account or
// user are dropped before anything is printed.
import { readFileSync } from "node:fs";
const drop = (o) => {
  if (Array.isArray(o)) return o.map(drop);
  if (o && typeof o === "object") {
    return Object.fromEntries(
      Object.entries(o)
        .filter(([k]) => !/email|key|token|account|user/i.test(k))
        .map(([k, v]) => [k, drop(v)]),
    );
  }
  return o;
};
for (const line of readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean)) {
  let e;
  try {
    e = drop(JSON.parse(line));
  } catch {
    console.log("raw", line.slice(0, 120));
    continue;
  }
  const head = `${e.type}${e.subtype ? `/${e.subtype}` : ""}`;
  if (e.type === "assistant") console.log(head, JSON.stringify(e.message?.content?.map((c) => c.text ?? c)).slice(0, 700));
  else if (e.type === "tool_call") console.log(head, JSON.stringify(e.tool_call ?? e).slice(0, 260));
  else if (e.type === "result") console.log(head, JSON.stringify(e.result ?? "").slice(0, 900), "duration_ms", e.duration_ms);
  else if (e.type === "system") console.log(head, "model", e.model ?? "", "cwd", e.cwd ?? "");
  else console.log(head);
}
