// Throwaway probe npm-style plugin package: logs its init and where it was loaded from.
import { appendFileSync } from "node:fs"
export default {
  id: "squeal-probe-pkg",
  server: async ({ directory }) => {
    appendFileSync(process.env.PROBE_LOG, JSON.stringify({ label: process.env.PROBE_LABEL, at: Date.now(), kind: "pkg.init", from: import.meta.url, directory }) + "\n")
    return {}
  },
}
