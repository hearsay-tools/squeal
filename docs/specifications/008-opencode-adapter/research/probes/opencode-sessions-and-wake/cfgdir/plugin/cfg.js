// Throwaway probe plugin, loaded from OPENCODE_CONFIG_DIR/plugin/: can a plugin bring a skill,
// an instruction file and a command on the shell's PATH without any config file edit?
import { appendFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets")
const log = (kind, d) => appendFileSync(process.env.PROBE_LOG, JSON.stringify({ label: process.env.PROBE_LABEL, at: Date.now(), kind, ...d }) + "\n")
export const CfgProbe = async ({ directory, worktree }) => {
  log("cfg.init", { directory, worktree, assets })
  return {
    async config(cfg) {
      cfg.skills ??= {}
      cfg.skills.paths = [...(cfg.skills.paths ?? []), path.join(assets, "skills")]
      cfg.instructions = [...(cfg.instructions ?? []), path.join(assets, "instructions.md")]
      log("cfg.config", { skills: cfg.skills, instructions: cfg.instructions })
    },
    async "shell.env"(input, output) {
      output.env.PATH = `${path.join(assets, "bin")}:${process.env.PATH}`
    },
  }
}
