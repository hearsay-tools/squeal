// Throwaway. One short line per logged record for a label: node summ.mjs <events.jsonl> <label>
import { readFileSync } from "node:fs"
const [file, label] = process.argv.slice(2)
const short = (s) => (s ? String(s).replace(/^(ses|msg|prt|call)_/, "").slice(-8) : "")
let base
for (const line of readFileSync(file, "utf8").split("\n")) {
  if (!line) continue
  const r = JSON.parse(line)
  if (label && r.label !== label) continue
  base ??= r.at
  const t = String(r.at - base).padStart(6)
  let s = r.kind
  if (r.kind === "event") {
    s = r.type + (r.type === "session.idle" ? ` ses=${short(r.sessionID)}` : "")
    if (r.info) s += ` ses=${short(r.info.sessionID ?? r.info.id)}${r.info.parentID ? " parent=" + short(r.info.parentID) : ""}${r.info.role ? " " + r.info.role : ""}${r.info.finish ? " finish=" + r.info.finish : ""}`
    if (r.part) s += ` ses=${short(r.part.sessionID)} ${r.part.type} ${r.part.tool ?? ""} call=${short(r.part.callID)} ${r.status ?? ""}`
    if (r.status && !r.part) s += ` ses=${short(r.sessionID)} ${JSON.stringify(r.status)}`
    if (r.keys) s += ` ses=${short(r.sessionID)} keys=${r.keys.join(",")}`
  } else if (["tool.before", "tool.after", "shell.env", "chat.message", "wake.call", "wake.result", "wake.throw"].includes(r.kind)) {
    s += ` ses=${short(r.sessionID)} ${r.tool ?? ""} ${r.callID ? "call=" + short(r.callID) : ""} ${r.agent ?? ""} ${r.status ?? ""} ${r.error ? JSON.stringify(r.error).slice(0, 200) : ""}`
  } else if (r.kind === "init") s += ` pid=${r.pid} ppid=${r.ppid} dir=${r.directory} worktree=${r.worktree} server=${r.serverUrl} ${r.runtime} env=${r.env}`
  else s += " " + JSON.stringify({ ...r, label: undefined, at: undefined, t: undefined, kind: undefined, pid: undefined })
  console.log(t, s)
}
