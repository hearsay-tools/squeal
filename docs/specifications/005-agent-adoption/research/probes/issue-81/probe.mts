// Throwaway probe for research/issue-81.md. See README.md.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keepVersion, keptSkill, dataLauncher } from "../../../../../../src/harness/shared/version-copies.ts";
import { skillLine } from "../../../../../../src/harness/codex/kept.ts";

const home = mkdtempSync(join(tmpdir(), "issue-81-"));
const cache = join(home, ".codex/plugins/cache/hearsay/squeal");
const data = join(home, ".codex/plugins/data/squeal-hearsay");
const install = (v: string) => {
  cpSync("plugins/codex", join(cache, v), { recursive: true });
  // Codex 0.160.1 remove_old_plugin_versions: every other version directory goes.
  for (const o of ["0.1.275", "0.1.276", "0.1.277"]) if (o !== v) rmSync(join(cache, o), { recursive: true, force: true });
};
const catalog = (v: string) => join(cache, v, "skills/squeal/SKILL.md");
const saved = (v: string) => join(data, "versions", v, "skills/squeal/SKILL.md");
const say = (k: string, v: unknown) => console.log(`${k}: ${v}`);
mkdirSync(cache, { recursive: true });
console.log("home", home);

console.log("\n# 1. Session on 0.1.275: catalog rendered, SessionStart keeps the copy");
install("0.1.275");
say("catalog path readable", existsSync(catalog("0.1.275")));
say("keepVersion(0.1.275)", keepVersion({ root: join(cache, "0.1.275"), data, version: "0.1.275" }));
const env = { PLUGIN_ROOT: join(cache, "0.1.275"), PLUGIN_DATA: data };
say("SessionStart skill line", JSON.stringify(skillLine({ env, squealVersion: "0.1.275" } as never)));

console.log("\n# 2. Codex installs 0.1.276 (startup auto-upgrade); next hook keeps 0.1.276");
install("0.1.276");
say("keepVersion(0.1.276)", keepVersion({ root: join(cache, "0.1.276"), data, version: "0.1.276" }));
say("catalog path 0.1.275 readable", existsSync(catalog("0.1.275")));
const cat = spawnSync("cat", [catalog("0.1.275")], { encoding: "utf8" });
say("cat catalog path stderr", cat.stderr.trim());
say("saved 0.1.275 skill readable", existsSync(saved("0.1.275")));
say("keptSkill(data, 0.1.275)", keptSkill(data, "0.1.275"));
say("launcher exists", existsSync(dataLauncher(data)));
say("launcher equals plugin's", readFileSync(dataLauncher(data), "utf8") === readFileSync("plugins/codex/bin/squeal-launcher", "utf8"));

console.log("\n# 3. A second install, 0.1.277, while the 0.1.275 session lives and no process names its copy");
install("0.1.277");
say("keepVersion(0.1.277)", keepVersion({ root: join(cache, "0.1.277"), data, version: "0.1.277" }));
say("saved 0.1.275 skill readable", existsSync(saved("0.1.275")));
say("saved 0.1.276 skill readable", existsSync(saved("0.1.276")));
say("launcher exists", existsSync(dataLauncher(data)));

rmSync(home, { recursive: true, force: true });
say("\ncleaned", !existsSync(home));
