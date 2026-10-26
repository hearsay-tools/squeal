#!/usr/bin/env bash
# Throwaway probe (016-33 Q4). Does a typed ESLint rule's finding in a.ts
# depend on b.ts? Two states differ only in b.ts's return type.
# Usage: typed.sh <scratch-dir-with-eslint-and-typescript-eslint> <out-file>
set -u
S=$1; OUT=$2
for st in t0-b-returns-number t1-b-returns-promise; do
  d="$S/states/$st"; mkdir -p "$d"
  printf '{"type":"module"}\n' > "$d/package.json"
  printf '{ "compilerOptions": { "strict": true, "module": "nodenext", "noEmit": true }, "files": ["a.ts", "b.ts"] }\n' > "$d/tsconfig.json"
  cat > "$d/eslint.config.js" <<'CFG'
import tseslint from "typescript-eslint";
export default [
  { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { "@typescript-eslint": tseslint.plugin }, rules: { "@typescript-eslint/no-floating-promises": "error" } },
];
CFG
  printf 'import { load } from "./b.js";\n\nexport function run(): void {\n  load();\n}\n' > "$d/a.ts"
  if [ $st = t0-b-returns-number ]; then printf 'export function load(): number {\n  return 1;\n}\n' > "$d/b.ts"
  else printf 'export async function load(): Promise<number> {\n  return 1;\n}\n' > "$d/b.ts"; fi
  # NODE_PATH does not reach ESM imports, so link the scratch node_modules beside the config.
  ln -sfn "$S/node_modules" "$d/node_modules"
  echo "== $st (a.ts unchanged; only b.ts differs)" >> "$OUT"
  (cd "$d" && "$S/node_modules/.bin/eslint" -f stylish a.ts >> "$OUT"; echo "exit $?" >> "$OUT")
done
echo "eslint $("$S/node_modules/.bin/eslint" --version); typescript-eslint $(node -p "require('$S/node_modules/typescript-eslint/package.json').version"); typescript $(node -p "require('$S/node_modules/typescript/package.json').version")" >> "$OUT"
