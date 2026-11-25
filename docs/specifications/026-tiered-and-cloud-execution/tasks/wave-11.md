# Spec 026, Wave 11: configurable Agent37 template and SSH user

Base: `4b0bf71ae` (`origin/main`, after `0.1.635` release).
Authorized by the human on 2026-11-25 ("As the optional field and let's test the Ubuntu template").

## Row 026-29: optional `template` and `sshUser` on Agent37 provider, plus `.tar.gz` Node bootstrap fallback

**Goal:** Let users select any Agent37 system template (such as `agent37-ubuntu` on Ubuntu 26.04 with Git 2.53) or custom workspace template (and optional `@<tag>` / `@<revision>` pin) in `providerConfig`, support non-`node` SSH users (such as `root` on `agent37-ubuntu`, where `mount_path` is `/root` and no `node` user exists), replace a tracked VM if the configured template changes, and allow `ensureNode` to fall back to `.tar.gz` when `xz` is absent on the remote image.

**Owned files:**
- `src/core/runner-host/remote/providers/agent37/config.ts`
- `src/core/runner-host/remote/providers/agent37/api.ts`
- `src/core/runner-host/remote/providers/agent37/machine.ts`
- `src/core/runner-host/remote/providers/agent37/index.ts`
- `src/core/runner-host/remote/providers/agent37/bootstrap.ts`
- `test/runner-host/remote/providers/agent37.test.ts`
- `test/runner-host/remote/providers/agent37-api.test.ts`
- `test/runner-host/remote/providers/agent37-node.test.ts`

Do not edit `package.json`, `docs/board.md`, or plugin bundles (`pnpm run build` is the coordinator's step).

**Requirements:**
1. **`config.ts`:**
   - Add `"template"` and `"sshUser"` to `KEYS` and `Agent37Settings` (`template: string`, default `"agent37-base"` in `AGENT37_DEFAULTS`; `sshUser?: string`, optional).
   - Validate `template`: when defined, must be a plain non-empty string matching `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?:@[A-Za-z0-9._-]{1,64})?$/` (accepts system names like `agent37-base`, `agent37-ubuntu`, custom names like `my-squeal-vm`, and version/revision pins like `agent37-ubuntu@2026.11.17a` or `my-squeal-vm@2`; rejects empty strings, spaces, slashes, shell metacharacters, or bare `@`).
   - Validate `sshUser`: when defined, must be a plain non-empty string matching `/^[A-Za-z_][A-Za-z0-9._-]{0,63}$/` (no spaces, `@`, or shell metacharacters).
   - Add a helper `defaultSshUser(template: string, mountPath?: string | null): string`: returns `"root"` when `mountPath === "/root"` or `template === "agent37-ubuntu"` or `template.startsWith("agent37-ubuntu@")`, otherwise `"node"`.
2. **`api.ts`:**
   - Extend `Instance` with optional `readonly mount_path?: string | null;` and `readonly template?: string | null;`.
   - Read them in `#instance` when present as strings (leave `undefined` when absent so existing mocks and API responses stay compatible).
3. **`machine.ts` and `index.ts`:**
   - Extend `Agent37State` with optional `readonly template?: string;` and `readonly sshUser?: string;`. Preserve them in `stateOf` when present as non-empty strings.
   - `agent37Ssh(settings, id, env, cli, sshUser?)` uses `sshUser ?? settings.sshUser ?? defaultSshUser(settings.template)` for `${user}@${id}.agent37.app`.
   - On `acquire`:
     - When `tracked !== null`: compare `const trackedTemplate = tracked.template ?? AGENT37_DEFAULTS.template`. If `trackedTemplate !== settings.template`, do **not** reuse the old instance: delete `tracked.instanceId` (`await api.remove(tracked.instanceId).catch(() => {})`), log `Agent37 instance ${tracked.instanceId} uses template ${trackedTemplate}, not ${settings.template}; replacing`, and fall through to create a fresh instance with `settings.template`.
     - When `tracked` is reused (same template): inspect and wake as before, and resolve `sshUser = settings.sshUser ?? tracked.sshUser ?? defaultSshUser(trackedTemplate, found.mount_path)`. If `sshUser !== tracked.sshUser`, update `state` with the resolved `sshUser` and `template: trackedTemplate`.
     - When creating a new instance: pass `template: settings.template` to `api.create(...)`. Resolve `sshUser = settings.sshUser ?? defaultSshUser(settings.template, made.mount_path)`. Store `template: settings.template` and `sshUser` in `state`. Log `Agent37 instance ${made.id} created (${settings.region} ${settings.type}, ${settings.template})`.
4. **`bootstrap.ts` (`NODE_SCRIPT`):**
   - Replace the unconditional `.tar.xz` / `tar -xJf` download with a check for `xz`:
     ```sh
     if command -v xz >/dev/null 2>&1; then F=node-v$V-linux-$A.tar.xz; X=-xJf
     else F=node-v$V-linux-$A.tar.gz; X=-xzf; fi
     ```
     and extract with `tar "$X" "$F" -C "$D" --strip-components=1`. `SHASUMS256.txt` from `nodejs.org` lists both `.tar.xz` and `.tar.gz`.
5. **Tests:**
   - `agent37.test.ts`:
     - Config validation accepts valid `template` (bare name, `@tag`, `@revision`) and `sshUser`, and rejects invalid values (empty, spaces, slashes, `@` in `sshUser`, shell metacharacters).
     - Acquire with `template: "agent37-ubuntu"` sends `template: "agent37-ubuntu"` to `POST /v1/instances`, connects SSH as `root@<id>.agent37.app`, and records `template` and `sshUser` in state.
     - Acquire with custom `template: "my-custom"` + `mount_path: "/root"` from API defaults SSH user to `root`; explicit `sshUser: "ubuntu"` overrides it.
     - Switching `template` when an older instance is tracked in `remote-machines.json` deletes the old instance and creates a new one with the new template.
     - Reusing a legacy tracked record (without `template`/`sshUser` fields) under default `agent37-base` still reuses without recreating and connects as `node@`.
   - `agent37-api.test.ts`: verify `mount_path` and `template` are parsed when returned and omitted safely when absent.
   - `agent37-node.test.ts`: verify `ensureNode` selects `.tar.gz` (`tar -xzf`) when `xz` is absent on `PATH` and `.tar.xz` (`tar -xJf`) when `xz` is present (using a local fake `curl` + `sha256sum` + real `tar` so no network is hit).
6. **Constraints:**
   - Do not include any `/home/` paths in code or tests (`check:private` rejects `/home/`).
   - Keep `KEY_FORMAT_VERSION` and SQLite schema untouched.
   - Run `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:private`, and `pnpm exec vitest run test/runner-host/remote/providers/agent37.test.ts test/runner-host/remote/providers/agent37-api.test.ts test/runner-host/remote/providers/agent37-node.test.ts test/runner-host/remote/providers/agent37-remote-cli.test.ts test/runner-host/remote/providers/agent37-attached.test.ts` (and read `squeal status --wait 60000` on your changed paths). Commit cleanly when done.
