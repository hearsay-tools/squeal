# dev-marketplace probe (throwaway)

Row 001-164, 2026-10-09, Claude Code 2.1.295 and Codex 0.160.1. Question: when this repository's own marketplace manifests are renamed (`squeal` to `squeal-dev`), what happens to a machine that added the marketplace under the old name and installed `squeal@squeal`?

`run.sh <empty dir>` builds a scratch tool repository with marketplace `tool`, serves it over smart HTTP on 127.0.0.1:8766 with `../release-hub/git-http.mjs`, installs `tool@tool` in both harnesses with `HOME` and `CODEX_HOME` inside the scratch dir, renames both manifests to `tool-dev` with a version raise, and updates. `run.log` is one run.

- Claude Code keeps the marketplace under the name it was added with (`tool`): `marketplace update` succeeds and `plugin update tool@tool` moves to the new version.
- Codex refuses: `Failed to upgrade marketplace 'tool': upgraded marketplace name 'tool-dev' does not match configured marketplace 'tool'`. The installed `tool@tool` stays at the old version and keeps working; it stops following the repository until the marketplace is removed and added again.

Decision (coordinator, 2026-10-09): the in-repo manifests stay named `squeal` in 001-164, since a rename would freeze the human's Codex `squeal@squeal` until the 001-165 migration. Renaming them to a dev name (`squeal-dev`) is a follow-up after that migration is done on every machine.
