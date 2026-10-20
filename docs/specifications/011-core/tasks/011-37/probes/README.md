# Throwaway probes: 011-37

**Throwaway.** Nothing here is product code. These scripts exist only to produce the evidence cited in `../design.md`. Delete them freely.

- `alias-cost.sh` + `alias-cost.mjs`: what reading formats 13 to 17 as one costs a lookup. The shell script refuses to start while the one-minute load is at or above the CPU count. It adds a detached worktree at `SHA` (default `origin/main`) under `/tmp/kfg37/wt`, points `HOME` and `XDG_*` at `/tmp/kfg37/home`, and runs the `.mjs` at `nice` 10 with Node 24's type stripping. No install, no build, no daemon, no suite. It measures the extra check keys a miss computes at 50, 300 and 1,000 closure paths, and, on a 200,000-row store in `/tmp/kfg37/scratch`, today's miss (`byKey`), the listed formats' miss (one `SELECT` over five keys), and a hit's copy (`INSERT ... SELECT ... WHERE NOT EXISTS`), each alone and 876 in one transaction. Output goes in `alias-cost.out` when it runs.
- `register.mjs`, `resolve-ts.mjs`: copied from `../../../research/probes/key-format-guard/`. They map relative `.js` imports to `.ts` so Node runs Squeal's sources unbuilt.

Clean up with `git worktree remove --force /tmp/kfg37/wt && rm -rf /tmp/kfg37`.
