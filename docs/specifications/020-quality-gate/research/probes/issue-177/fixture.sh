#!/bin/sh
# Throwaway probe for hearsay-tools/squeal#177 (research/issue-177.md).
# Builds a synthetic Git repository under ignored .scratch/, commits a base,
# makes a behaviour-neutral refactor in the working tree, then runs
# `squeal code --base HEAD` twice: default text and --json.
#   sh fixture.sh <squeal.mjs>
# Skips while the one-minute load is above the CPU count.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../../../.." && pwd)
cli=${1:-$repo/plugins/claude-code/dist/cli/squeal.mjs}
load=$(cut -d' ' -f1 /proc/loadavg); cpus=$(nproc)
if [ "$(echo "$load > $cpus" | bc)" = 1 ]; then echo "skipped: load $load > $cpus"; exit 0; fi
echo "load $load, cpus $cpus, cli $cli, version $(node "$cli" --version)"
root="$here/.scratch/case-$(date +%s)"; mkdir -p "$root/src" "$root/test"; cd "$root"
ln -s "$repo/node_modules" node_modules
git init -q; git config user.email p@p; git config user.name p
printf 'node_modules\n' > .gitignore
printf '{"name":"s177","private":true,"type":"module"}\n' > package.json
printf '{"checks":[{"name":"unit","runner":"vitest","at":"edit"}]}\n' > squeal.config.json
printf 'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n' > vitest.config.ts
cat > src/old.ts <<'TS'
export function clamp(x: number): number {
  if (x < 0) return 0;
  return x > 9 ? 9 : x;
}
export function sign(x: number): number {
  return x < 0 ? -1 : 1;
}
export function oldName(x: number): number {
  return x + 1;
}
export function main(x: number): number {
  return clamp(x) * sign(x);
}
TS
cat > test/old.test.ts <<'TS'
import { describe, expect, it } from "vitest";
import { main } from "../src/old";
describe("main", () => {
  it("clamps", () => {
    expect(main(12)).toBe(9);
  });
  it("signs", () => {
    expect(main(5)).toBe(5);
  });
  it("keeps", () => {
    expect(main(4)).toBe(4);
  });
  it("noop", () => {});
});
TS
git add -A; git commit -qm base
# Head (working tree): clamp and sign moved verbatim to src/helpers.ts,
# oldName renamed (same parameters and body), main edited.
cat > src/helpers.ts <<'TS'
export function clamp(x: number): number {
  if (x < 0) return 0;
  return x > 9 ? 9 : x;
}
export function sign(x: number): number {
  return x < 0 ? -1 : 1;
}
export function newName(x: number): number {
  return x + 1;
}
TS
cat > src/old.ts <<'TS'
import { clamp, sign } from "./helpers";
export function main(x: number): number {
  const c = clamp(x);
  return c * sign(x);
}
TS
# Test callbacks: "clamps" title renamed only; "signs" reindented;
# "keeps" edited to equal the base "clamps" body; a new empty callback added
# (equal to the base "noop" body); a new real callback added.
cat > test/old.test.ts <<'TS'
import { describe, expect, it } from "vitest";
import { main } from "../src/old";
describe("main", () => {
  it("clamps above nine", () => {
    expect(main(12)).toBe(9);
  });
  it("signs", () => {
      expect(main(5)).toBe(5);
  });
  it("keeps", () => {
    expect(main(12)).toBe(9);
  });
  it("noop", () => {});
  it("noop two", () => {});
  it("zero", () => {
    expect(main(0)).toBe(0);
  });
});
TS
echo "--- git diff --stat HEAD (with untracked)"; git add -N src/helpers.ts; git diff --stat HEAD
echo "--- squeal code --base HEAD"; set +e
node "$cli" code --base HEAD > text.out 2>&1; echo "exit $?"; cat text.out
node "$cli" code --base HEAD --json > report.json 2>json.err; echo "--json exit $?"; cat json.err
node -e '
const r=require(process.argv[1]);
console.log("format",r.format,"verdict",r.verdict,"counts",JSON.stringify(r.counts));
for (const f of r.functions) console.log(f.path, f.qualifiedName ?? f.name, "occ", f.occurrence, f.change, f.state, "cc", f.cc ?? f.complexity, "crap", f.crap);
console.log("top-level keys", Object.keys(r).join(","));
' "$root/report.json"
echo "root $root"
