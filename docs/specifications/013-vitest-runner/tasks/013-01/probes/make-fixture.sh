#!/usr/bin/env bash
# 013-01 probe fixture: writes the repository graph-probe.mjs ran against into $1 (a new
# directory under /tmp). Give it a node_modules with Vitest 5.0.3 (a copy, never a link:
# Vite and Vitest write their caches under it). Throwaway; not product code, not a test.
set -euo pipefail
R=${1:?usage: make-fixture.sh <new dir under /tmp>}
mkdir -p "$R/src/glob" "$R/src/__mocks__" "$R/test" "$R/opt" "$R/dist"
cd "$R"
echo '{ "name": "probe-013-01", "private": true, "type": "module" }' > package.json
printf 'dist/\nnode_modules/\n' > .gitignore
cat > vitest.config.ts <<'EOF'
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const here = import.meta.dirname;
export default defineConfig({
  plugins: [
    {
      name: "probe-virtual",
      resolveId(id) {
        if (id === "virtual:which") return "\0virtual:which";
        if (id === "virtual:only") return "\0virtual:only";
        if (id === "zero:file") return `\0${resolve(here, "src/zero.ts")}`;
      },
      load(id) {
        if (id === "\0virtual:which") {
          const file = resolve(here, "src/mod.ts");
          this.addWatchFile(file);
          return readFileSync(file, "utf8");
        }
        if (id === "\0virtual:only") {
          const file = resolve(here, "src/only-input.txt");
          this.addWatchFile(file);
          return `export const only = ${JSON.stringify(readFileSync(file, "utf8").trim())};`;
        }
        if (id.startsWith("\0/")) return readFileSync(id.slice(1), "utf8");
      },
    },
  ],
  test: {
    css: { include: [/.+/] },
    setupFiles: ["./src/setup.ts"],
    globalSetup: ["./src/global-setup.ts"],
  },
});
EOF
for mode in on off; do
  enabled=$([ "$mode" = on ] && echo true || echo false)
  cat > "vitest.optimizer-$mode.config.ts" <<EOF
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "local-pkg": resolve(import.meta.dirname, "src/aliased.js") } },
  test: {
    include: ["opt/*.test.ts"],
    deps: { optimizer: { ssr: { enabled: $enabled, include: ["local-pkg"] } } },
  },
});
EOF
done
echo 'export const which = "old";' > src/mod.ts
echo 'old-only' > src/only-input.txt
echo 'export const zero = "zero";' > src/zero.ts
echo 'export const dyn = "dyn";' > src/dyn.ts
echo 'export const lib = 1;' > src/lib.ts
echo 'export const setup = 1; (globalThis as any).__setup = true;' > src/setup.ts
echo 'export default function () {}' > src/global-setup.ts
printf '@import "./base.css";\n.x { color: red; }\n' > src/style.css
printf '.base { content: "old"; }\n' > src/base.css
printf '@import "./base2.css";\n.y { color: blue; }\n' > src/plain.css
printf '.base2 { content: "old2"; }\n' > src/base2.css
echo 'export const a = "a";' > src/glob/a.ts
echo 'export const mocked = "real";' > src/mocked.ts
echo 'export const mocked = "from __mocks__";' > src/__mocks__/mocked.ts
echo 'export const actual = "actual";' > src/actual.ts
echo 'raw text' > src/raw.txt
echo 'export const aliased = "aliased";' > src/aliased.js
echo 'export const loaded = "loaded";' > dist/loaded.js
echo 'export const unrelated = "unrelated";' > dist/unrelated.js
t() { printf 'import { expect, test%s } from "vitest";\n%s\n' "$2" "$3" > "$1"; }
t test/virtual.test.ts "" 'import { which } from "virtual:which";
test("virtual", () => expect(which).toBe("old"));'
t test/plain.test.ts "" 'import { which } from "../src/mod.ts";
test("plain", () => expect(which).toBe("old"));'
t test/only.test.ts "" 'import { only } from "virtual:only";
test("only", () => expect(only).toBe("old-only"));'
t test/css.test.ts "" 'import css from "../src/style.css?inline";
test("css inline", () => expect(css).toContain("old"));'
t test/css-plain.test.ts "" 'import "../src/plain.css";
test("css plain", () => expect(1).toBe(1));'
t test/zero.test.ts "" 'import { zero } from "zero:file";
test("zero", () => expect(zero).toBe("zero"));'
t test/computed.test.ts "" 'test("computed", async () => {
  const path = ["..", "src", "dyn.ts"].join("/");
  const mod = await import(/* @vite-ignore */ path);
  expect(mod.dyn).toBe("dyn");
});'
t test/dist.test.ts "" 'import { loaded } from "../dist/loaded.js";
test("dist", () => expect(loaded).toBe("loaded"));'
t test/lib.test.ts "" 'import { lib } from "../src/lib.ts";
test("lib", () => expect(lib).toBe(1));'
t test/glob.test.ts "" 'const modules = import.meta.glob("../src/glob/*.ts");
test("lazy glob", async () => {
  const mod = (await modules["../src/glob/a.ts"]()) as { a: string };
  expect(mod.a).toBe("a");
});'
t test/mock.test.ts ", vi" 'import { mocked } from "../src/mocked.ts";
vi.mock("../src/mocked.ts");
test("__mocks__", () => expect(mocked).toBe("from __mocks__"));'
t test/actual.test.ts ", vi" 'test("importActual", async () => {
  const mod = await vi.importActual<{ actual: string }>("../src/actual.ts");
  expect(mod.actual).toBe("actual");
});'
t test/raw.test.ts "" 'import raw from "../src/raw.txt?raw";
test("raw", () => expect(raw).toContain("raw"));'
t opt/aliased.test.ts "" 'import { aliased } from "local-pkg";
test("aliased", () => expect(aliased).toBe("aliased"));'
git init -q && git add -A && git -c user.email=p@p -c user.name=p commit -qm fixture
