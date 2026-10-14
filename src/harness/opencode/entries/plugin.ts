import type { OcPluginModule } from "../api.js";
import { squealPlugin } from "../plugin.js";

/*
 * The OpenCode package's plugin (spec 008 D1, D4), bundled as
 * `dist/plugin.mjs`, the package's `exports["./server"]`. It runs in
 * OpenCode's Bun: paths come from `import.meta.url` without `node:url`.
 */
const at = (relative: string) => decodeURIComponent(new URL(relative, import.meta.url).pathname);

export default {
  id: "squeal",
  server: squealPlugin({ entry: at("./hooks/opencode.mjs"), bin: at("../bin") }),
} satisfies OcPluginModule;
