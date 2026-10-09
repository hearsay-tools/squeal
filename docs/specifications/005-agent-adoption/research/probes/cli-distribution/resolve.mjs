// Throwaway (005-05). Prints the Squeal CLI of the installed plugin, resolved now:
// Claude Code's installed_plugins.json (a project entry for the cwd wins, then user),
// else Codex's cache. Exit 1 with a reason when neither has one.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const home = process.env.HOME, id = process.env.SQUEAL_PLUGIN_ID ?? "squeal@hearsay";
const [name, market] = id.split("@"), cwd = process.cwd();
const cli = (dir) => join(dir, "dist/cli/squeal.mjs");
try {
  const all = JSON.parse(readFileSync(join(home, ".claude/plugins/installed_plugins.json"), "utf8")).plugins[id] ?? [];
  const mine = all.filter((e) => e.projectPath && (cwd === e.projectPath || cwd.startsWith(e.projectPath + "/")))
    .sort((a, b) => b.projectPath.length - a.projectPath.length);
  for (const e of [...mine, ...all.filter((e) => e.scope === "user")])
    if (existsSync(cli(e.installPath))) { console.log(cli(e.installPath)); process.exit(0); }
} catch {}
const codex = join(process.env.CODEX_HOME ?? join(home, ".codex"), "plugins/cache", market, name);
try {
  for (const v of readdirSync(codex)) if (existsSync(cli(join(codex, v)))) { console.log(cli(join(codex, v))); process.exit(0); }
} catch {}
console.error(`squeal: no installed ${id} plugin found`); process.exit(1);
