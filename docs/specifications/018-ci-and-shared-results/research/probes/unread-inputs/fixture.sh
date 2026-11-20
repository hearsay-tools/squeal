#!/usr/bin/env bash
# Throwaway probe (row 018-56). Six one-test fixtures, each recorded with `squeal ci record`
# and exported with `squeal ci export` at the content the command leaves, as review
# 0.1.421-r2 B1 did. The wrapper runs inside the recorded command. Per mode it writes:
#   start.txt / end.txt  every tracked file's blob id when the wrapper starts and when it ends
#   evidence/            the raw evidence (bundle patched with SQUEAL_PROBE_KEEP)
#   uncertified.json     the inputs `ci export` left out (patched with SQUEAL_PROBE_UNCERTIFIED)
#   truth.txt            plain Vitest at the content the export certifies: pass or fail
# Usage: fixture.sh <scratch-dir> <squeal.mjs patched> <node_modules with vitest>
set -u
scratch=$1 squeal=$2 modules=$3
here=$(cd "$(dirname "$0")" && pwd)

make_fixture() { # <dir> <value.ts content> <data/value.txt content>
  local d=$1
  rm -rf "$d" && mkdir -p "$d/src" "$d/test" "$d/data"
  cd "$d" || exit 1
  git init -q && git config user.email p@p && git config user.name p
  ln -s "$modules" node_modules
  printf 'node_modules\n' > .gitignore
  printf '{"type":"module","private":true}\n' > package.json
  printf 'export default { test: { include: ["test/*.test.ts"], maxWorkers: 1 } }\n' > vitest.config.mjs
  # The data file is a declared input, as cezar declares `.github/scripts/**`.
  printf '{"inputs":{"test/*.test.ts":["data/**"]}}\n' > squeal.config.json
  printf '%s\n' "$2" > src/value.ts
  printf '%s\n' "$3" > data/value.txt
  printf 'export const other = 1;\n' > src/keep.ts
  git add -A && git commit -qm fixture
}

hashes() { git ls-files -z | xargs -0 git hash-object -- | paste -d' ' - <(git ls-files); }

for mode in shell-restore-import shell-generate-import shell-restore-native-read untouched-native-read node-restore-native-read today-node-read-first; do
  d=$scratch/$mode
  case $mode in
    shell-restore-import|shell-generate-import)
      make_fixture "$d" 'export const value = "BAD";' 'GOOD' ;;
    *)
      make_fixture "$d" 'export const value = "BAD";' 'BAD' ;;
  esac
  case $mode in
    shell-restore-import) # review B: a tracked module changed before Vitest and restored after
      cat > test/a.test.ts <<'EOF'
import { expect, it } from "vitest";
import { value } from "../src/value.ts";
it("value", () => expect(value).toBe("GOOD"));
EOF
      cat > ../wrap-$mode.sh <<'EOF'
cp src/value.ts /tmp/.r56-keep-$$ && printf 'export const value = "GOOD";\n' > src/value.ts
node_modules/.bin/vitest run; s=$?
cp /tmp/.r56-keep-$$ src/value.ts && rm /tmp/.r56-keep-$$; exit $s
EOF
      ;;
    shell-generate-import) # review C: a module generated before Vitest and removed after
      cat > test/a.test.ts <<'EOF'
import { expect, it } from "vitest";
it("generated", async () => expect((await import("../src/generated.ts")).value).toBe("GOOD"));
EOF
      cat > ../wrap-$mode.sh <<'EOF'
printf 'export const value = "GOOD";\n' > src/generated.ts
node_modules/.bin/vitest run; s=$?
rm src/generated.ts; exit $s
EOF
      ;;
    *) # a declared input that only a shell reads (no path in the spawn's arguments)
      cat > test/a.test.ts <<'EOF'
import { execSync } from "node:child_process";
import { expect, it } from "vitest";
it("data", () => expect(execSync("cat data/value.txt").toString().trim()).toBe("GOOD"));
EOF
      case $mode in
        shell-restore-native-read) cat > ../wrap-$mode.sh <<'EOF'
printf 'GOOD\n' > data/value.txt
node_modules/.bin/vitest run; s=$?
git checkout -q -- data/value.txt; exit $s
EOF
          ;;
        untouched-native-read) # the commit holds GOOD here: the case the rule is for
          printf 'GOOD\n' > data/value.txt && git commit -qam good
          printf 'node_modules/.bin/vitest run\n' > ../wrap-$mode.sh ;;
        today-node-read-first) # D8's accepted case under today's rule: a Node read at the commit's content first
          cat > ../wrap-$mode.sh <<'EOF'
node -e 'require("fs").readFileSync("data/value.txt")'
printf 'GOOD\n' > data/value.txt
node_modules/.bin/vitest run; s=$?
git checkout -q -- data/value.txt; exit $s
EOF
          ;;
        node-restore-native-read) cat > ../wrap-$mode.sh <<'EOF'
node -e 'require("fs").writeFileSync("data/value.txt", "GOOD\n")'
node_modules/.bin/vitest run; s=$?
node -e 'require("fs").writeFileSync("data/value.txt", "BAD\n")'; exit $s
EOF
          ;;
      esac ;;
  esac
  git add -A && git commit -qm test
  cat > ../run-$mode.sh <<EOF
cd "$d"; git ls-files -z | xargs -0 git hash-object -- | paste -d' ' - <(git ls-files) > ../$mode-start.txt
bash ../wrap-$mode.sh; s=\$?
git ls-files -z | xargs -0 git hash-object -- | paste -d' ' - <(git ls-files) > ../$mode-end.txt; exit \$s
EOF
  rm -rf "../$mode-out" && mkdir -p "../$mode-out"
  CI=true SQUEAL_PROBE_KEEP="$scratch/$mode-out/evidence" node "$squeal" ci record --out "../$mode-out/parts" -- bash "../run-$mode.sh" > "../$mode-out/record.log" 2>&1
  echo "record exit $?" >> "../$mode-out/record.log"
  CI=true SQUEAL_PROBE_UNCERTIFIED="$scratch/$mode-out/uncertified.json" node "$squeal" ci export --parts "../$mode-out/parts" --out "../$mode-out/export.json.gz" > "../$mode-out/export.log" 2>&1
  echo "export exit $?" >> "../$mode-out/export.log"
  node_modules/.bin/vitest run > "../$mode-out/truth.log" 2>&1 && echo pass > "../$mode-out/truth.txt" || echo fail > "../$mode-out/truth.txt"
  mv "../$mode-start.txt" "../$mode-out/start.txt"; mv "../$mode-end.txt" "../$mode-out/end.txt"
  node "$here/simulate.mjs" "$scratch/$mode-out" "$d" > "../$mode-out/rule.txt"
  echo "== $mode: truth at the exported content $(cat "../$mode-out/truth.txt")"
  grep -h "Exported\|Left out\|refused\|wrote nothing" "../$mode-out/export.log"
  cat "../$mode-out/rule.txt"
done
