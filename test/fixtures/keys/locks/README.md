# lock fixtures

One package set locked by npm and by pnpm, for `test/keys/validity/lock.test.ts` (row 017-11): the comparison's dependency lines must agree across the two formats. npm nests `ms` 2.0.0 under `debug`; `ms1` is an alias; `ts-api-utils` has a peer; `esbuild` has optional platform packages. Nothing here is installed. Made with:

    (cd npm && npm install --package-lock-only --ignore-scripts)
    (cd pnpm && pnpm install --lockfile-only --ignore-scripts)

pnpm 12.15.0 writes its own pin as the lockfile's first document.
