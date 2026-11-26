# Jest fixtures (spec 028)

- `project/`: the smallest Jest project, a CommonJS config and one passing test.
- `jest-29/`, `jest-30/`: a `package.json` that pins Jest 29.7.0 or 30.5.2, with its `pnpm-lock.yaml`.

No `node_modules` here. `test/helpers/jest-env.ts` copies `project/` and one version's files into a
folder under the temp directory and runs `pnpm install --frozen-lockfile --config.hoist=false`
there, so the tests resolve pnpm's strictest layout: only `jest` at the top of `node_modules`, and
no hidden hoisted folder.
To move a pin, edit the `package.json` and run `pnpm install --lockfile-only --ignore-workspace`
in a copy of the folder outside this repository's workspace, then copy the lockfile back.
