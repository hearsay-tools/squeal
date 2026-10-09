import type { Vitest } from "vitest/node";

/*
 * Spec 001 D4 (task 001-176; reviews wave-13d S1 to wave-13f B4): Vite's
 * dependency optimizer bundles what `deps.optimizer.*.include` names,
 * project sources reached through an alias included, into files no plugin
 * container loads. So no stamp, touch or key names the bytes a bundle holds:
 * one built before the first key scan, one kept across a restart and one an
 * ordinary edit left in place each ran other bytes than the stored result's
 * key. Every Vitest instance Squeal makes runs without it.
 *
 * No `createVitest` option reaches it everywhere: `test.deps` is not among
 * the CLI options Vitest hands a project with its own config file, and
 * Vite's inline config reaches the root server only. Vite builds each
 * environment's optimizer with its server, and its resolver decides then
 * that one exists, so the optimizer cannot be removed afterwards. What it
 * resolves to a bundle is read from its `metadata` at each resolve and load;
 * emptied before the first load, nothing resolves to a bundle, and every
 * import goes through the plugin container, stamped like any module. Vitest
 * builds no optimizer that discovers imports (`noDiscovery`) outside browser
 * mode, so the emptied metadata stays empty.
 */

type Server = Vitest["projects"][number]["vite"];

/** Every Vite server of `vitest`: the root's and each project's. */
function servers(vitest: Vitest): Set<Server> {
  return new Set([vitest.vite, ...vitest.projects.map((p) => p.vite)]);
}

/**
 * Turns the dependency optimizer off in every environment of every server of
 * `vitest`, and every project's `deps.optimizer` entry with it, so the
 * workers are told so too. Returns the names of the projects whose config
 * turned it on, sorted. Call before anything loads a module.
 */
export function withoutOptimizer(vitest: Vitest): string[] {
  const enabled = new Set<string>();
  for (const project of vitest.projects) {
    for (const option of Object.values(project.config.deps?.optimizer ?? {})) {
      if (option?.enabled !== true) continue;
      enabled.add(project.name);
      option.enabled = false;
    }
  }
  for (const server of servers(vitest)) {
    for (const environment of Object.values(server.environments)) {
      const optimizer = environment.depsOptimizer;
      if (optimizer === undefined) continue;
      const { metadata } = optimizer;
      optimizer.metadata = {
        ...metadata,
        optimized: {},
        chunks: {},
        discovered: {},
        depInfoList: [],
      };
      for (const project of vitest.projects) if (project.vite === server) enabled.add(project.name);
    }
  }
  return [...enabled].sort();
}

/**
 * What any environment of `vitest` would resolve to an optimizer's bundle,
 * and each project's `deps.optimizer` entries still on, as
 * `<project>:<environment>:<id>`: empty once `withoutOptimizer` ran.
 */
export function optimizerInUse(vitest: Vitest): string[] {
  const found: string[] = [];
  for (const project of vitest.projects) {
    for (const [name, option] of Object.entries(project.config.deps?.optimizer ?? {})) {
      if (option?.enabled === true) found.push(`${project.name}:${name}:enabled`);
    }
    for (const [name, environment] of Object.entries(project.vite.environments)) {
      const metadata = environment.depsOptimizer?.metadata;
      if (metadata === undefined) continue;
      const ids = [
        ...Object.keys(metadata.optimized),
        ...Object.keys(metadata.chunks),
        ...Object.keys(metadata.discovered),
        ...metadata.depInfoList.map((info) => info.id),
      ];
      found.push(...ids.map((id) => `${project.name}:${name}:${id}`));
    }
  }
  return [...new Set(found)].sort();
}

/** Texts noted per worktree root in this process: the fast and each slow instance note it once. */
const noted = new Map<string, Set<string>>();

/** `note(text)` unless this process already noted it for `root`. */
export function noteOnce(root: string, text: string, note: (text: string) => void): void {
  const texts = noted.get(root) ?? new Set<string>();
  noted.set(root, texts);
  if (texts.has(text)) return;
  texts.add(text);
  note(text);
}
