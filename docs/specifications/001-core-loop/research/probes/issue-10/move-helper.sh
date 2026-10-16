#!/bin/sh
# Throwaway (issue 10 research). The reporter's edit at $1, one atomic step:
# move the import-free helper from src/lib to e2e unchanged and update both
# importers. With "full" as $2, also delete a module and its unit test, as the
# reporter's script did in the same step. With "none", move nothing: only
# append a comment to the unit test (the no-move control).
set -eu
cd "$1/packages/web"
if [ "${2:-}" = none ]; then echo '// edited' >> src/lib/nav-contract.test.ts; exit 0; fi
mv src/lib/nav-contract.ts e2e/nav-contract.ts
sed -i "s#from './nav-contract'#from '../../e2e/nav-contract'#" src/lib/nav-contract.test.ts
sed -i "s#from '../src/lib/nav-contract'#from './nav-contract'#" e2e/nav.e2e.ts
if [ "${2:-}" = full ]; then rm src/lib/backdrop.ts src/lib/backdrop.test.ts; fi
