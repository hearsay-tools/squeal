// Throwaway probe plugin for research topic opencode-sessions-and-wake (spec 008).
// Logs every hook and bus event to $PROBE_LOG as JSON lines, adds ids to the
// shell environment, and optionally wakes an idle root session once.
// PROBE_WAKE: "none" (default), "immediate", or "delay:<ms>".
// PROBE_SPAWN=1: spawn one detached and one attached child at init, to see
// which survives the OpenCode process.
import { appendFileSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"

const LOG = process.env.PROBE_LOG ?? "/tmp/opencode-probe.jsonl"
const LABEL = process.env.PROBE_LABEL ?? "unlabelled"
const t0 = Date.now()

function log(kind, data) {
  appendFileSync(LOG, JSON.stringify({ label: LABEL, t: Date.now() - t0, at: Date.now(), pid: process.pid, kind, ...data }) + "\n")
}

function pick(o, keys) {
  const r = {}
  for (const k of keys) if (o && o[k] !== undefined) r[k] = o[k]
  return r
}

export const ProbePlugin = async (input) => {
  const { client, directory, worktree, project } = input
  let serverUrl
  try {
    serverUrl = String(input.serverUrl)
  } catch (e) {
    serverUrl = `throws: ${e}`
  }
  log("init", {
    directory,
    worktree,
    project: pick(project, ["id", "worktree", "vcs"]),
    serverUrl,
    ppid: process.ppid,
    argv: process.argv,
    runtime: typeof Bun === "undefined" ? `node ${process.version}` : `bun ${Bun.version}`,
    env: Object.keys(process.env).filter((k) => /^(OPENCODE|PROBE|AGENT)/.test(k)),
  })

  if (process.env.PROBE_SPAWN === "1") {
    const script = `const fs=require("fs");setInterval(()=>fs.appendFileSync(process.argv[1], Date.now()+"\\n"),1000)`
    const det = spawn(process.execPath.endsWith("node") ? process.execPath : "node", ["-e", script, `${LOG}.detached-beat`], { detached: true, stdio: "ignore" })
    det.unref()
    const att = spawn("node", ["-e", script, `${LOG}.attached-beat`], { stdio: "ignore" })
    att.unref()
    writeFileSync(`${LOG}.pids`, JSON.stringify({ detached: det.pid, attached: att.pid }))
    log("spawned", { detached: det.pid, attached: att.pid })
  }

  const parents = new Map() // sessionID -> parentID|null
  let woke = false
  const wake = process.env.PROBE_WAKE ?? "none"

  async function doWake(sessionID) {
    const text = process.env.PROBE_WAKE_TEXT ?? "Squeal: tests/add.test.js PASS -> FAIL at revision 3. Reply with exactly WAKE-OK and nothing else."
    log("wake.call", { sessionID })
    try {
      const res = await client.session.promptAsync({ path: { id: sessionID }, body: { parts: [{ type: "text", text }] } })
      log("wake.result", { sessionID, status: res.response?.status, error: res.error ?? null })
    } catch (e) {
      log("wake.throw", { sessionID, error: String(e) })
    }
  }

  return {
    async event({ event }) {
      const p = event.properties ?? {}
      if (event.type === "message.part.delta") return
      const info = p.info ?? {}
      const part = p.part ?? {}
      const entry = { type: event.type }
      if (event.type.startsWith("session.")) {
        Object.assign(entry, pick(p, ["sessionID", "status"]), { info: pick(info, ["id", "parentID", "directory", "title"]) })
        if (info.id) parents.set(info.id, info.parentID ?? null)
      } else if (event.type === "message.updated") {
        Object.assign(entry, { info: pick(info, ["id", "sessionID", "role", "parentID", "finish"]) })
      } else if (event.type === "message.part.updated") {
        if (part.type === "text" || part.type === "reasoning") return
        Object.assign(entry, { part: pick(part, ["sessionID", "messageID", "type", "tool", "callID"]), status: part.state?.status })
      } else {
        Object.assign(entry, { keys: Object.keys(p), sessionID: p.sessionID })
      }
      log("event", entry)

      const sid = p.sessionID ?? info.id
      const idle = event.type === "session.idle" || (event.type === "session.status" && p.status?.type === "idle")
      if (idle && event.type === "session.idle" && sid && parents.get(sid) == null && !woke && wake !== "none") {
        woke = true
        if (wake === "immediate") await doWake(sid)
        else if (wake.startsWith("delay:")) setTimeout(() => void doWake(sid), Number(wake.slice(6)))
      }
    },
    async "chat.message"(input, output) {
      log("chat.message", { ...pick(input, ["sessionID", "agent", "messageID"]), msg: pick(output.message, ["id", "sessionID"]) })
    },
    async "shell.env"(input, output) {
      log("shell.env", input)
      output.env.PROBE_SESSION_ID = input.sessionID ?? ""
      output.env.PROBE_CALL_ID = input.callID ?? ""
    },
    async "tool.execute.before"(input) {
      log("tool.before", input)
    },
    async "tool.execute.after"(input) {
      log("tool.after", pick(input, ["tool", "sessionID", "callID"]))
    },
    async dispose() {
      log("dispose", {})
    },
  }
}
