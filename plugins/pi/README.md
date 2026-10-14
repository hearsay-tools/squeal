# Squeal package for Pi

Spec 009 D1, D4 and D6. This directory is a Pi package: `package.json` declares `./dist/extension.mjs` explicitly (Pi's directory scan ignores a bare `.mjs`) and `./skills`, and names Pi as a peer it never bundles. `dist/` is committed and built by `npm run build:plugin` (`src/harness/pi/build.ts`): the extension, its delivery worker `worker.mjs`, the CLI and daemon under `cli/`, and the runtime files. The skill is copied from the Claude Code plugin with one line saying `squeal` is not on the PATH under Pi.

## Install

`pi install <this directory>` at user scope. Pi writes its own settings and references a local directory in place, without copying it; Squeal writes nothing under `~/.pi`.

`install.sh` (the root README's Install) does this for a release: with `pi` on the `PATH` it unpacks this directory from the tag's source archive into `${XDG_DATA_HOME:-~/.local/share}/squeal/pi/<version>/` and runs `pi install` on it. A later release's `install.sh` installs its own directory, then `pi remove`s the older one; `--uninstall` runs `pi remove` and deletes the directory. Both act only on what `install.sh` recorded in `~/.local/state/squeal/installed`. `bin/squeal-launcher` is the launcher every plugin ships; with only Pi, `install.sh` copies it from here to `~/.local/bin/squeal`, and it finds the newest package under that data directory.

A package puts nothing on the `PATH`, so Squeal's texts in Pi name the CLI as the Node that runs Pi with `--disable-warning=ExperimentalWarning "<this directory>/dist/cli/squeal.mjs"`. In a Pi shell where the extension never registered the session (`PI_SESSION_ID` set, no consumer of it), `squeal status` adds a line saying so, with the install command.

## How it runs

Pi loads `dist/extension.mjs` into its own process and awaits each handler with no timeout. So the extension does no store work itself: at `session_start` it starts `dist/worker.mjs` in a `worker_threads` worker, and each handler posts one request to it and awaits the answer against a deadline (`src/harness/pi/host.ts`). A missed deadline, a dead worker or a throw is silence, and the next request starts a fresh worker. The worker runs the shared hook code (`src/harness/pi/session.ts`, `src/harness/shared/`) with Pi's own process as the consumer's harness process.

Nothing the extension holds keeps Node alive: the worker is unreferenced, and a call's deadline timer is referenced only while that call is pending. The worker's `unref()` must follow its `message` listener, which refs the worker's port again; `test/harness/pi/bundle.test.ts` catches the reverse order as a `pi -p` that never exits.
