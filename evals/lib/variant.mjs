// A variant's plugin copy (spec 006 D8): string patches with a minimum match count, removed
// paths. Its instruction text and policy apply to the fixture, in the runner.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Replaces every `patch.find` in `text`: `{ text, count }`. Exported for the bundle walk below
 * and for tests.
 */
export function applyPatch(text, patch) {
  const count = text.split(patch.find).length - 1;
  return { text: count ? text.replaceAll(patch.find, patch.replace) : text, count };
}

/**
 * Applies `variant.patch` to the files of every plugin under `pluginsDir` that the patch's
 * `files` names (`plugins/*` or `plugins/<name>`): `.../dist/**\/*.mjs` is the plugin's `.mjs`
 * bundles, any other path one file in the plugin (`plugins/*\/skills/squeal/SKILL.md`). Throws
 * when a patch matches fewer than its `min` (default 1) times: a rebuild that moved the string
 * fails loudly instead of running the shipped text under the variant's name. Returns
 * `[{ find, count }]`.
 */
export function patchPlugins(pluginsDir, variant) {
  const applied = [];
  for (const p of variant.patch ?? []) {
    const [, glob, rest] = /^(plugins\/[^/]+)\/(.*)$/.exec(p.files) ?? [];
    if (!glob) throw new Error(`patch files must start plugins/<name>/: ${p.files}`);
    let count = 0;
    for (const plugin of readdirSync(pluginsDir)) {
      if (!glob.endsWith("*") && !glob.endsWith(`/${plugin}`)) continue;
      const files = rest.startsWith("dist/")
        ? walk(join(pluginsDir, plugin, "dist")).filter((f) => f.endsWith(".mjs"))
        : [join(pluginsDir, plugin, rest)].filter((f) => existsSync(f));
      for (const f of files) {
        const r = applyPatch(readFileSync(f, "utf8"), p);
        if (r.count) writeFileSync(f, r.text);
        count += r.count;
      }
    }
    const min = p.min ?? 1;
    if (count < min)
      throw new Error(
        `patch matched ${count} times, expected at least ${min}: ${p.find.slice(0, 60)}`,
      );
    applied.push({ find: p.find.slice(0, 60), count });
  }
  return applied;
}

/**
 * The variant's pinned copy at `dir`, built once from `pinBase` (a `git archive` of the commit
 * under test): Codex's marketplace renamed `hearsay` so the plugin id is `squeal@hearsay`
 * (005-02), the patches applied, the removed paths gone, and `PIN.json` recording both.
 */
export function buildPin(pinBase, dir, name, variant) {
  if (existsSync(join(dir, "PIN.json"))) return dir;
  rmSync(dir, { recursive: true, force: true });
  cpSync(pinBase, dir, { recursive: true });
  const marketplace = join(dir, ".agents/plugins/marketplace.json");
  writeFileSync(
    marketplace,
    readFileSync(marketplace, "utf8").replace('"name": "squeal"', '"name": "hearsay"'),
  );
  const applied = patchPlugins(join(dir, "plugins"), variant);
  for (const r of variant.remove ?? []) rmSync(join(dir, r), { recursive: true, force: true });
  writeFileSync(
    join(dir, "PIN.json"),
    JSON.stringify({ variant: name, applied, removed: variant.remove ?? [] }, null, 2),
  );
  return dir;
}

function walk(d) {
  if (!existsSync(d)) return [];
  return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );
}
