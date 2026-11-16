# Probe for 005-94 texts (throwaway)

Throwaway. `render.ts` calls the real formatters of the commit it runs on and prints the "before" texts that `../texts.md` quotes. It writes nothing and starts no daemon. It reads `squeal.config.json` of this worktree for the default coverage, and nothing else.

Run from the worktree root: `node_modules/.bin/tsx docs/specifications/005-agent-adoption/tasks/005-94/probe/render.ts > /tmp/005-94-before.txt`.

`TZ=UTC` is set inside the script, so the late-feed clock reads the same on every machine.

`after.ts` prints the drafted primer for each coverage with its length and which sentences it kept. It imports `primer-after.ts`, a copy of `src/harness/shared/primer.ts` at `9967ce790` with the 005-94 wording and the path wait tried first; it is a draft for measuring, not the implementation. `PRIMER_CHECKPOINT=1` measures open choice C3 (b). Run: `node_modules/.bin/tsx docs/specifications/005-agent-adoption/tasks/005-94/probe/after.ts`.
