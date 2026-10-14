# Squeal package for Pi

Spec 009 D1, D4 and D6. This directory is a Pi package: `package.json` declares `./dist/extension.mjs` explicitly (Pi's directory scan ignores a bare `.mjs`) and `./skills`, and names Pi as a peer it never bundles. `dist/` is committed and built by `npm run build:plugin` (`src/harness/pi/build.ts`): the extension, its delivery worker `worker.mjs`, the CLI and daemon under `cli/`, and the runtime files. The skill is copied from the Claude Code plugin with one line saying `squeal` is not on the PATH under Pi.

## Install

`pi install <this directory>` at user scope. Pi writes its own settings and references a local directory in place, without copying it; Squeal writes nothing under `~/.pi`. `install.sh` gains this step in wave 1.

## How it runs

Pi loads `dist/extension.mjs` into its own process and awaits each handler with no timeout. So the extension does no store work itself: at `session_start` it starts `dist/worker.mjs` in a `worker_threads` worker, and each handler posts one request to it and awaits the answer against a deadline (`src/harness/pi/host.ts`). A missed deadline, a dead worker or a throw is silence, and the next request starts a fresh worker. The worker runs the shared hook code (`src/harness/pi/session.ts`, `src/harness/shared/`) with Pi's own process as the consumer's harness process.

Nothing the extension holds keeps Node alive: the worker is unreferenced, and a call's deadline timer is referenced only while that call is pending. The worker's `unref()` must follow its `message` listener, which refs the worker's port again; `test/harness/pi/bundle.test.ts` catches the reverse order as a `pi -p` that never exits.
