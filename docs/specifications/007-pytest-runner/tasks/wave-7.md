# Wave 7: PEP 582 refusal names a working stand-in

From `research/pep582-environments.md` (007-57) and `research/tests-in-docker.md` (007-58); the human, 2026-10-28: "Message only, slot row planned".

## 007-59 the PEP 582 refusal names a working stand-in (slice)

Use /worker.

**Outcome:** when `pdm.toml` sets `python.use_venv = false` and no supported environment exists, the note tells the user how to get one today: `PDM_USE_VENV=true pdm install` in the project directory creates `.venv` there and leaves `pdm.toml` unchanged. The note also says that this rewrites `.pdm-python`, so a later plain `pdm run` in that checkout uses the `.venv`.

**Read:** `research/pep582-environments.md` Q7 and Recommendation 1 (`out/9-venv-override.txt`); `spec.md` D2.

**Seam:** `src/runners/pytest/environment/states.ts`, the `pdmDisablesVenv` branch of `environmentState`. First edit: the note's last two sentences. `command` stays `null`: the command changes how the project's own `pdm run` behaves, so Squeal names it and does not offer it as the default fix. Keep the refusal itself and every state unchanged.

**Owns:** that file, `test/runners/pytest/environment/states.test.ts`, and any other test that pins the note text. Leave alone: discovery, keys, `docs/board.md`, `spec.md`, `status.md`, plugin bundles (no `pnpm run build`).

**Done when:** tests assert the note names `PDM_USE_VENV=true pdm install`, the directory, the unchanged `pdm.toml` and the `.pdm-python` effect, in text and JSON status; the existing PEP 582 cases still pass; lint, typecheck and `squeal status --wait 60000` on the changed paths are clean, reported in the final message.

## 007-59 repair after review FAIL (`reviews/0.1.376.md`, B1 and B2)

Use /worker. Shape: repair, on the candidate `cand/0.1.376` (start from `8510d281d`; do not touch the release commit's bundles or versions).

**Outcome:** the note is true in every state where it appears. B1: with PDM's `venv.in_project = false` (local or global config), the named commands must still create `<cwd>/.venv`, or the note must not promise it; `PDM_VENV_IN_PROJECT=true` is PDM's override (`pdm/project/config.py`). Also check that `pdm use -f` cannot select an existing virtual environment outside the project (the reviewer's warning), and that the sequence works with `__pypackages__` present and with a non-venv `.pdm-python`. B2: when the project declares `python` in `squeal.config.json` and that path is missing, the note says the declared path is missing and that it must name the new `.venv/bin/python` or be created; it does not promise that the PDM commands alone are enough.

**Seam:** `src/runners/pytest/environment/states.ts`, the `pdmDisablesVenv` branch. Keep `command: null`, discovery order, states and keys unchanged. Probe PDM only with `HOME`, `XDG_*`, `PDM_HOME` and `PDM_CACHE_DIR` in your scratch folder.

**Owns:** that file, `test/runners/pytest/environment/states.test.ts`, `test/runners/pytest/environment/pep582-status.test.ts`. No `pnpm run build`.

**Done when:** tests cover `venv.in_project = false`, a missing declared `python`, `__pypackages__` present, and the existing cases; text and JSON status carry the note; lint, typecheck and the named test files pass; the final message names the PDM probe results.
