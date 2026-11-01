#!/usr/bin/env bash
# Q1/Q2 (throwaway): single input changes the replay does not make, each as a
# fresh `oxlint --format json` before and after. Usage: cases.sh <scratch> <toolDir> <probeDir>
set -u
S=$1; T=$2; PROBE=$3
OX="node $T/node_modules/oxlint/bin/oxlint"
export HOME=$S/home OXLINT_TSGOLINT_PATH=$T/node_modules/.bin/tsgolint
codes() { $OX --format json "$@" 2>&1 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.diagnostics.map(d=>`${d.filename}:${d.code??"(no code)"}`).sort().join(" ")||"(none)")}catch{console.log("NOT JSON: "+s.split("\n").slice(0,2).join(" | "))}})'; }
fresh() { rm -rf "$1"; mkdir -p "$1/src"; cd "$1"; git init -q .; printf 'node_modules\n' > .gitignore; ln -s "$T/node_modules" node_modules; }

echo "## 1. tsconfig paths decide import resolution (import/no-cycle, no type-aware)"
fresh $S/case-paths
printf '{ "plugins": ["import"], "rules": { "import/no-cycle": "error" } }\n' > .oxlintrc.json
printf 'import { y } from "@lib/y";\nexport const x = (): number => y();\n' > src/x.ts
printf 'import { x } from "./x";\nexport const y = (): number => 1;\nexport const z = x;\n' > src/y.ts
printf '{ "compilerOptions": { "baseUrl": ".", "paths": {} } }\n' > tsconfig.json
echo "before (no alias): $(codes src/x.ts)"
printf '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["src/*"] } } }\n' > tsconfig.json
echo "after  (alias):    $(codes src/x.ts)"

echo "## 2. tsconfig compiler options decide a type-aware rule"
fresh $S/case-strict
printf '{ "options": { "typeAware": true }, "rules": { "typescript/no-unnecessary-condition": "error" } }\n' > .oxlintrc.json
printf 'export function f(x: string): number {\n  if (x === null) return 1;\n  return 2;\n}\n' > src/f.ts
printf '{ "compilerOptions": { "strict": true }, "include": ["src"] }\n' > tsconfig.json
echo "strict true:  $(codes src/f.ts)"
printf '{ "compilerOptions": { "strict": false }, "include": ["src"] }\n' > tsconfig.json
echo "strict false: $(codes src/f.ts)"

echo "## 3. a config above the project root"
fresh $S/case-parent/project
printf '{ "rules": { "no-debugger": "off", "eqeqeq": "error" } }\n' > ../.oxlintrc.json
printf 'export const f = (x: number) => x == 1;\n' > src/a.ts
echo "no root config, parent config: $(codes src/a.ts)"
printf '{ "rules": { "eqeqeq": "off" } }\n' > .oxlintrc.json
echo "root config present:           $(codes src/a.ts)"
rm ../.oxlintrc.json

echo "## 4. a TypeScript config and the module it imports (observed through a Node preload)"
fresh $S/case-tsconfig
printf 'export const shared = { eqeqeq: "error" } as const;\n' > shared.ts
printf 'import { defineConfig } from "oxlint";\nimport { shared } from "./shared.ts";\nexport default defineConfig({ rules: { ...shared } });\n' > oxlint.config.ts
printf 'export const f = (x: number) => x == 1;\n' > src/a.ts
echo "shared eqeqeq error: $(codes src/a.ts)"
printf 'export const shared = { eqeqeq: "off" } as const;\n' > shared.ts
echo "shared eqeqeq off:   $(codes src/a.ts)"
OBSERVE_OUT=$S/obs-case4.json node --import "$PROBE/observe.mjs" $T/node_modules/oxlint/bin/oxlint --format json src/a.ts > /dev/null
echo "project files the JS side read: $(node -e 'console.log(require(process.argv[1]).filter(p=>p.startsWith(process.argv[2]+"/")&&!p.includes("node_modules")).map(p=>p.slice(process.argv[2].length+1)).join(", "))' $S/obs-case4.json $PWD)"

echo "## 5. a git-ignored file: walked versus named"
fresh $S/case-gitignore
printf 'node_modules\nsrc/ignored.ts\n' > .gitignore
printf '{ "rules": { "eqeqeq": "error" } }\n' > .oxlintrc.json
printf 'export const f = (x: number) => x == 1;\n' > src/ignored.ts
echo "whole run: $(codes)"
echo "named:     $(codes src/ignored.ts)"
echo "--debug files, named: $($OX --debug files src/ignored.ts | tr '\n' ' ')"

echo "## 6. threads do not change findings (replay fixture, mode A copy)"
cd $S/replay-A
echo "default threads: $(codes)"
echo "--threads 1:     $(codes --threads 1)"
