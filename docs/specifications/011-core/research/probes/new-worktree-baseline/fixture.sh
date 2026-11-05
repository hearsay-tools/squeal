#!/bin/sh
# Builds the 011-299 fixture repository at $X/fx: 8 Vitest files of about 1 s each, two importing child_process;
# test/h.test.ts also imports src/a.ts and src/b.ts (a "hub" pair two branches can both change).
set -e
X=${X:-$TMPDIR/nw/x}; SQ=${SQ:?path of a squeal checkout with node_modules}
mkdir -p $X/home $X/run $X/tmp $X/xdg/config/squeal $X/xdg/cache $X/xdg/data $X/xdg/state; chmod 700 $X/run
echo '{"capacity":{"hostSlots":4}}' > $X/xdg/config/squeal/config.json
rm -rf $X/fx; mkdir -p $X/fx/src $X/fx/test; cd $X/fx
git init -q -b main
ln -s $SQ/node_modules node_modules
printf 'node_modules\n.squeal-scratch\n' > .gitignore
echo '{"name":"fx","private":true,"type":"module"}' > package.json
printf 'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"], testTimeout: 120000 } });\n' > vitest.config.ts
echo '{"baseline":{"onStart":"lookup-then-run-missing"},"complexity":{"enabled":false},"coverage":{"enabled":false},"crap":{"enabled":false}}' > squeal.config.json
for n in a b c d e f g h; do
  printf 'export const %s = (x: number) => x + 1;\n' $n > src/$n.ts
  imp=""; [ $n = g ] || [ $n = h ] && imp='import { execFileSync } from "node:child_process";\n'
  [ $n = h ] && imp="${imp}import { a as a2 } from \"../src/a.js\";\nimport { b as b2 } from \"../src/b.js\";\n"
  use="$n(1)"; want=2; [ $n = h ] && use="h(1) + a2(0) + b2(0)" && want=4
  printf "${imp}import { test, expect } from \"vitest\";\nimport { $n } from \"../src/$n.js\";\ntest(\"$n\", async () => { await new Promise((r) => setTimeout(r, ${MS:-1000})); expect($use).toBe($want); });\n" > test/$n.test.ts
done
git add -A && git commit -qm fixture
