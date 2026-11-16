# Probe for 005-94 texts (throwaway)

Throwaway. `render.ts` calls the real formatters of the commit it runs on and prints the "before" texts that `../texts.md` quotes. It writes nothing and starts no daemon. It reads `squeal.config.json` of this worktree for the default coverage, and nothing else.

Run from the worktree root: `node_modules/.bin/tsx docs/specifications/005-agent-adoption/tasks/005-94/probe/render.ts > /tmp/005-94-before.txt`.

`TZ=UTC` is set inside the script, so the late-feed clock reads the same on every machine.
