# Wave 7: PEP 582 refusal names a working stand-in

From `research/pep582-environments.md` (007-57) and `research/tests-in-docker.md` (007-58); the human, 2026-10-28: "Message only, slot row planned".

## 007-59 the PEP 582 refusal names a working stand-in (slice)

Use /worker.

**Outcome:** when `pdm.toml` sets `python.use_venv = false` and no supported environment exists, the note tells the user how to get one today: `PDM_USE_VENV=true pdm install` in the project directory creates `.venv` there and leaves `pdm.toml` unchanged. The note also says that this rewrites `.pdm-python`, so a later plain `pdm run` in that checkout uses the `.venv`.

**Read:** `research/pep582-environments.md` Q7 and Recommendation 1 (`out/9-venv-override.txt`); `spec.md` D2.

**Seam:** `src/runners/pytest/environment/states.ts`, the `pdmDisablesVenv` branch of `environmentState`. First edit: the note's last two sentences. `command` stays `null`: the command changes how the project's own `pdm run` behaves, so Squeal names it and does not offer it as the default fix. Keep the refusal itself and every state unchanged.

**Owns:** that file, `test/runners/pytest/environment/states.test.ts`, and any other test that pins the note text. Leave alone: discovery, keys, `docs/board.md`, `spec.md`, `status.md`, plugin bundles (no `pnpm run build`).

**Done when:** tests assert the note names `PDM_USE_VENV=true pdm install`, the directory, the unchanged `pdm.toml` and the `.pdm-python` effect, in text and JSON status; the existing PEP 582 cases still pass; lint, typecheck and `squeal status --wait 60000` on the changed paths are clean, reported in the final message.
