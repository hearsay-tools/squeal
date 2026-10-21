// Throwaway probe for research 013-05: the fix candidate "break the retainer after a close".
// Rolldown's native vite-resolve plugin keeps a strong handle on Vite's onWarn callback. Its
// closure holds a PartialEnvironment that Vite made while it resolved the config, and through
// it the config's plugins, whose hooks close over the Vitest instance (ctx) and the server.
// That PartialEnvironment is not reachable from the instance, so the handle cannot be cut.
// Instead, after close(), this empties what the handle reaches: every own property of the
// closed Vitest, its logger, its projects, each Vite server (root and per project), their
// resolved configs' plugin objects, and their environments and those environments' plugins.
// The handle then keeps empty shells. Returns how many objects were emptied.
// With { plugins: false }, plugin objects are left alone: a config may import a ready-made
// plugin object from a package, which the next instance then shares.
export function breakRetainer(vitest, { plugins = true } = {}) {
  const seen = new Set();
  const empty = (o) => {
    if (o === null || typeof o !== "object" || seen.has(o)) return;
    seen.add(o);
    for (const key of Reflect.ownKeys(o)) {
      try { delete o[key]; } catch {}
    }
  };
  const get = (f) => { try { return f(); } catch { return undefined; } };
  const servers = new Set([get(() => vitest.vite), ...(get(() => vitest.projects) ?? []).map((p) => get(() => p.vite))].filter(Boolean));
  const projects = [...(get(() => vitest.projects) ?? [])];
  for (const server of servers) {
    if (plugins) for (const plugin of get(() => server.config.plugins) ?? []) empty(plugin);
    for (const env of Object.values(get(() => server.environments) ?? {})) {
      if (plugins) for (const plugin of get(() => env.plugins) ?? []) empty(plugin);
      empty(env);
    }
  }
  for (const server of servers) empty(server);
  for (const project of projects) empty(project);
  empty(get(() => vitest.logger));
  empty(vitest);
  return seen.size;
}
