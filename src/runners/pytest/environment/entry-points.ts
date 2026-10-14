import { join } from "node:path";
import type { AbsolutePath } from "../../../core/types/index.js";
import { listOptional, readOptional } from "./site.js";

/** One `pytest11` entry point: a plugin pytest loads without being named. */
export interface PytestPlugin {
  /** The distribution from its `.dist-info` directory name. */
  readonly distribution: string;
  readonly name: string;
  /** The module the entry point names, before any `:attr`. */
  readonly module: string;
}

/**
 * Spec 007 D2: "the closure of every `pytest11` entry-point plugin [...]
 * inside the worktree (D4), found from `entry_points.txt`". The plugins,
 * from every `*.dist-info/entry_points.txt` of site-packages; the graph
 * (D4) resolves each module and adds the closures inside the worktree.
 */
export function pytestPlugins(site: AbsolutePath | null): readonly PytestPlugin[] {
  if (site === null) return [];
  const plugins: PytestPlugin[] = [];
  for (const dir of listOptional(site)) {
    if (!dir.endsWith(".dist-info")) continue;
    const text = readOptional(join(site, dir, "entry_points.txt"));
    if (text === null) continue;
    const distribution = dir.slice(0, -".dist-info".length).split("-")[0] as string;
    for (const [name, value] of section(text, "pytest11")) {
      const module = value.split(":")[0]?.trim() ?? "";
      if (module !== "") plugins.push({ distribution, name, module });
    }
  }
  return plugins;
}

/** `name = value` lines of one `[section]` of an entry-points file, `#` and `;` comments skipped. */
function section(text: string, wanted: string): readonly (readonly [string, string])[] {
  const entries: (readonly [string, string])[] = [];
  let current: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header !== null) current = header[1]?.trim() ?? null;
    else if (current === wanted) {
      const at = line.indexOf("=");
      if (at > 0) entries.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
    }
  }
  return entries;
}
