// Spawned with `env: {}`; spawns its own grandchild with `env: {}` again.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const grandchild = fileURLToPath(new URL("./grandchild.mjs", import.meta.url));
const out = execFileSync(process.execPath, [grandchild], { env: {}, encoding: "utf8" });
process.stdout.write(`child:${out}`);
