# Fetched source evidence

Fetched 2026-10-27. Codex tag `rust-v0.164.0`, commit `6aaac694803004a63c6f393d153c96d22521a6b9`. Excerpts are research evidence, not vendored implementation.


## core-plugins/src/manifest.rs

URL: https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core-plugins/src/manifest.rs

Fetched raw file SHA-256: `cb6cc5e8e2004d1533141a3f11f3460a1aa8c2e0295c9583ae9726c6a75b2802`

Lines 47–78:

```rust



#[derive(Debug, Default, Deserialize)]

#[serde(rename_all = "camelCase")]

struct RawPluginManifest {

    #[serde(default)]

    name: String,

    #[serde(default)]

    version: Option<String>,

    #[serde(default)]

    description: Option<String>,

    #[serde(default)]

    keywords: Vec<String>,

    // Keep manifest paths as raw strings so we can validate the required `./...` syntax before

    // resolving them under the plugin root.

    #[serde(default)]

    skills: Option<RawPluginManifestPaths>,

    #[serde(default)]

    mcp_servers: Option<RawPluginManifestMcpServers>,

    #[serde(default)]

    apps: Option<String>,

    #[serde(default)]

    hooks: Option<RawPluginManifestHooks>,

    #[serde(default)]

    interface: Option<RawPluginManifestInterface>,

    #[serde(default)]

    extensions: JsonValue,

}



#[derive(Deserialize)]

struct RawPluginCommandManifest {

    #[serde(default)]

    commands: Option<RawPluginManifestPaths>,

```

## core-plugins/src/agent_plugin_manifest.rs

URL: https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core-plugins/src/agent_plugin_manifest.rs

Fetched raw file SHA-256: `31f9efd68ad2a94e45d1596123d49066886c4592aa7588935170913ced1cc660`

Lines 18–55:

```rust

const AGENT_PLUGIN_FIELDS: &[&str] = &[

    "$schema",

    "name",

    "version",

    "description",

    "author",

    "homepage",

    "repository",

    "license",

    "keywords",

    "extensions",

];



#[derive(Debug, Deserialize)]

#[serde(rename_all = "camelCase")]

struct RawAgentPluginManifest {

    #[serde(rename = "$schema")]

    schema: String,

    name: String,

    #[serde(default)]

    version: Option<String>,

    #[serde(default)]

    description: Option<String>,

    #[serde(default)]

    author: Option<RawAgentPluginAuthor>,

    #[serde(default)]

    homepage: Option<String>,

    #[serde(default, rename = "repository")]

    _repository: Option<String>,

    #[serde(default, rename = "license")]

    _license: Option<String>,

    #[serde(default)]

    keywords: Vec<String>,

}



#[derive(Debug, Deserialize)]

#[serde(deny_unknown_fields)]

struct RawAgentPluginAuthor {

```

Lines 75–88:

```rust

    };

    for field in object.keys() {

        if !AGENT_PLUGIN_FIELDS.contains(&field.as_str()) {

            tracing::warn!(path = %manifest_path, field, "ignoring unknown Agent Plugins manifest field");

        }

    }

    object.retain(|field, _| AGENT_PLUGIN_FIELDS.contains(&field.as_str()));

    if object

        .get("extensions")

        .is_some_and(|extensions| !extensions.is_object())

    {

        tracing::warn!(path = %manifest_path, "ignoring non-object Agent Plugins `extensions` field");

        object.remove("extensions");

    }

```

## core-plugins/src/manager.rs

URL: https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core-plugins/src/manager.rs

Fetched raw file SHA-256: `8b8555475ac5efa3f4efc9755137096ba043cfb99b27fbeff0c9745767cc1501`

Lines 2257–2332:

```rust

    async fn install_resolved_plugin(

        &self,

        resolved: ResolvedMarketplacePlugin,

    ) -> Result<PluginInstallOutcome, PluginInstallError> {

        let auth_policy = resolved.policy.authentication;

        let plugin_version =

            if is_openai_curated_marketplace_name(&resolved.plugin_id.marketplace_name) {

                let curated_plugin_version = read_curated_plugins_sha(self.codex_home.as_path())

                    .ok_or_else(|| {

                        PluginStoreError::Invalid(

                            "local curated marketplace sha is not available".to_string(),

                        )

                    })?;

                Some(curated_plugin_cache_version(&curated_plugin_version))

            } else {

                None

            };

        let store = self.store.clone();

        let codex_home = self.codex_home.clone();

        let manifest_fallback_contents = resolved

            .manifest_fallback

            .contents_if_has_metadata()

            .map(str::to_string);

        let result: StorePluginInstallResult = tokio::task::spawn_blocking(move || {

            let materialized =

                materialize_marketplace_plugin_source(codex_home.as_path(), &resolved.source)

                    .map_err(PluginStoreError::Invalid)?;

            let source_path = materialized.path;

            match (plugin_version, manifest_fallback_contents.as_deref()) {

                (Some(plugin_version), Some(manifest_contents)) => store

                    .install_with_version_and_fallback_manifest(

                        source_path,

                        resolved.plugin_id,

                        plugin_version,

                        manifest_contents,

                    ),

                (Some(plugin_version), None) => {

                    store.install_with_version(source_path, resolved.plugin_id, plugin_version)

                }

                (None, Some(manifest_contents)) => store.install_with_fallback_manifest(

                    source_path,

                    resolved.plugin_id,

                    manifest_contents,

                ),

                (None, None) => store.install(source_path, resolved.plugin_id),

            }

        })

        .await

        .map_err(PluginInstallError::join)??;



        set_user_plugin_enabled(

            &self.codex_home,

            result.plugin_id.as_key(),

            /*enabled*/ true,

        )

        .await

        .map_err(anyhow::Error::from)?;



        let analytics_events_client = match self.analytics_events_client.read() {

            Ok(client) => client.clone(),

            Err(err) => err.into_inner().clone(),

        };

        if let Some(analytics_events_client) = analytics_events_client {

            analytics_events_client.track_plugin_installed(

                self.telemetry_metadata_for_installed_plugin(&result.plugin_id)

                    .await,

            );

        }



        Ok(PluginInstallOutcome {

            plugin_id: result.plugin_id,

            plugin_version: result.plugin_version,

            installed_path: result.installed_path,

            auth_policy,

        })

    }

```

## core-plugins/src/npm_source.rs

URL: https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core-plugins/src/npm_source.rs

Fetched raw file SHA-256: `f778bda6f855632fcf50d05c12174d52f44b1bba600d67d212fd5c65cc65ec3d`

Lines 24–80:

```rust

        version,

        registry,

        OsStr::new(npm_command()),

    )

}



fn materialize_npm_plugin_source_with_command(

    codex_home: &Path,

    package: &str,

    version: Option<&str>,

    registry: Option<&str>,

    npm_command: &OsStr,

) -> Result<(AbsolutePathBuf, TempDir), String> {

    let staging_root = codex_home.join(NPM_PLUGIN_SOURCE_STAGING_DIR);

    fs::create_dir_all(&staging_root).map_err(|err| {

        format!(

            "failed to create marketplace plugin source staging directory {}: {err}",

            staging_root.display()

        )

    })?;

    let tempdir = tempfile::Builder::new()

        .prefix("marketplace-plugin-source-")

        .tempdir_in(&staging_root)

        .map_err(|err| {

            format!(

                "failed to create marketplace plugin source staging directory in {}: {err}",

                staging_root.display()

            )

        })?;



    pack_npm_package(tempdir.path(), package, version, registry, npm_command)?;

    let archive_path = find_npm_package_archive(tempdir.path())?;

    let archive_bytes = read_npm_package_archive(&archive_path)?;



    let extraction_root = tempdir.path().join("extracted");

    unpack_plugin_bundle_tar_gz(

        &archive_bytes,

        &extraction_root,

        NPM_PLUGIN_SOURCE_MAX_EXTRACTED_BYTES,

    )

    .map_err(|err| format!("failed to extract npm plugin package: {err}"))?;

    let plugin_root = extraction_root.join(NPM_PACKAGE_ARCHIVE_ROOT);

    if !plugin_root.is_dir() {

        return Err(format!(

            "npm pack completed without creating plugin package directory {}",

            plugin_root.display()

        ));

    }

    validate_npm_package_metadata(&plugin_root, package)?;

    let plugin_root = AbsolutePathBuf::try_from(plugin_root)

        .map_err(|err| format!("failed to resolve materialized plugin source path: {err}"))?;

    Ok((plugin_root, tempdir))

}



fn pack_npm_package(

    destination: &Path,

    package: &str,

```

Lines 91–117:

```rust

        .current_dir(destination)

        .arg("pack")

        .arg("--ignore-scripts")

        .arg("--pack-destination")

        .arg(destination);

    if let Some(registry) = registry {

        command.arg("--registry").arg(registry);

    }

    command.arg("--").arg(package_spec);



    let output = command

        .output()

        .map_err(|err| format!("failed to run npm pack: {err}"))?;

    if output.status.success() {

        return Ok(());

    }



    Err(format!(

        "npm pack failed with status {}\nstdout:\n{}\nstderr:\n{}",

        output.status,

        String::from_utf8_lossy(&output.stdout).trim(),

        String::from_utf8_lossy(&output.stderr).trim()

    ))

}



fn find_npm_package_archive(destination: &Path) -> Result<PathBuf, String> {

    let mut archives = fs::read_dir(destination)

```

## core/src/session/turn.rs

URL: https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/session/turn.rs

Fetched raw file SHA-256: `42a290c7ff6563d7eee7728d62ca70ec599a33ff985b9fb132ac1c21109b3517`

Lines 328–343:

```rust

    let Some((injection_items, explicitly_enabled_connectors)) = build_skills_and_plugins(

        &sess,

        first_step_context.as_ref(),

        &user_input,

        &mentioned_plugins,

        &cancellation_token,

    )

    .await

    else {

        return Ok(None);

    };



    if run_pending_session_start_hooks(&sess, &turn_context).await {

        return Ok(None);

    }

    if crate::guardian::is_basic_session_source(&turn_context.session_source)

```

## core/src/hook_runtime.rs

URL: https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/hook_runtime.rs

Fetched raw file SHA-256: `a320509ee9070694207155b195eb468dad50dd66288ae50a3b058d6d3944672f`

Lines 127–180:

```rust

pub(crate) async fn run_pending_session_start_hooks(

    sess: &Arc<Session>,

    turn_context: &Arc<TurnContext>,

) -> bool {

    while let Some(session_start_source) = sess.take_pending_session_start_source().await {

        // Spawned subagents can start fresh or fork their parent's history, so both

        // sources dispatch SubagentStart. Internal/system subagents skip start hooks.

        let target = match &turn_context.session_source {

            SessionSource::SubAgent(SubAgentSource::ThreadSpawn { agent_role, .. })

                if matches!(

                    session_start_source,

                    codex_hooks::SessionStartSource::Startup

                        | codex_hooks::SessionStartSource::Fork

                ) =>

            {

                let context = subagent_hook_context(sess, agent_role);

                StartHookTarget::SubagentStart {

                    turn_id: turn_context.sub_id.clone(),

                    agent_id: context.agent_id,

                    agent_type: context.agent_type,

                }

            }

            SessionSource::SubAgent(_) => return false,

            _ => StartHookTarget::SessionStart {

                source: session_start_source,

            },

        };

        let request = codex_hooks::SessionStartRequest {

            session_id: sess.session_id().into(),

            #[allow(deprecated)]

            cwd: turn_context.cwd.clone(),

            transcript_path: sess.hook_transcript_path().await,

            model: turn_context.model_info().slug.clone(),

            permission_mode: hook_permission_mode(turn_context.approval_policy()),

            target,

        };

        let hooks = sess.hooks();

        let preview_runs = hooks.preview_session_start(&request);

        if run_context_injecting_hook(

            sess,

            turn_context,

            preview_runs,

            hooks.run_session_start(request, Some(turn_context.sub_id.clone())),

        )

        .await

        .record_additional_contexts(sess, turn_context)

        .await

        {

            return true;

        }

    }



    false

}

```

## Official documentation

Fetched 2026-10-27; these pages are mutable and may cover clients newer than 0.164.0.

https://developers.openai.com/plugins/build/plugins.md

Fetched Markdown SHA-256: `c37e330df8f040df8ee2f48035992b37c6a7decf6c3f5640822ca0907118c4e1`

```text

`package` is required and can include a registry scope. `version` is optional

and accepts package versions, distribution tags, and version ranges, but not

path or URL selectors.

`registry` is optional and must be an HTTPS URL without embedded credentials,

a query, or a fragment. Codex downloads the package without running lifecycle

scripts. The `npm` CLI must be installed, and registry authentication comes

from its configuration.



```

```text

### Add an onboarding skill



Give users a setup workflow to run after installing your plugin by declaring an

onboarding skill. When users run setup, it invokes the skill in a new

conversation, or in the existing conversation if they installed the plugin

during that conversation.



Add the setup skill to your package at `skills/setup/SKILL.md`. Write its

instructions using the [skills guide](https://developers.openai.com/plugins/build/skills), then set

`extensions.com.openai.onboardingSkill` in your manifest:



```json

{

  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",

  "name": "my-plugin",

  "version": "0.1.0",

  "description": "Reusable skills with a guided setup workflow",

  "extensions": {

    "com.openai": {

      "onboardingSkill": "./skills/setup/SKILL.md"

    }

  }

}

```



The field is optional. Its path is relative to the plugin root and must point

to a skill included in the package. For the Codex compatibility format, put

the same `extensions.com.openai.onboardingSkill` field in

`.codex-plugin/plugin.json`; the path still resolves from the plugin root.



Keep the skill focused on the setup your plugin needs, such as helping users

choose a workspace or configure preferences. After installing a test package,

run setup and verify that it invokes the packaged skill. Test both a fresh

```

https://developers.openai.com/codex/hooks.md

Fetched Markdown SHA-256: `57166ef03e7059732dd90925d5c42dd4d187eb2625d66cc154d0fbd2edb65f92`

```text

- `description` is optional top-level metadata for a `hooks.json` file. It

  doesn't change which hooks run.

- `timeout` is in seconds.

- If `timeout` is omitted, Codex uses `600` seconds for most hooks.

  - `SessionEnd` and `Interrupt` use `1` second by default and support up to `3` seconds.

- `statusMessage` is optional.

- `additionalContextLimit` sets how much `additionalContext` a command hook can

```

```text



`SessionStart`, `PreCompact`, `PostCompact`, `UserPromptSubmit`,

`SubagentStop`, and `Stop` support these shared JSON fields. `SubagentStart`

accepts the same shape for `systemMessage` and hook-specific context, but

`continue: false` doesn't stop the subagent:



```json

{

  "continue": true,

  "stopReason": "optional",

  "systemMessage": "optional",

  "suppressOutput": false

}

```



| Field            | Effect                                          |

| ---------------- | ----------------------------------------------- |

| `continue`       | If `false`, marks that hook run as stopped      |

| `stopReason`     | Recorded as the reason for stopping             |

| `systemMessage`  | Surfaced as a warning in the UI or event stream |

| `suppressOutput` | Parsed today but not yet implemented            |



Exit `0` with no output is treated as success and Codex continues.

```

```text

### SessionStart



`matcher` is applied to `source` for this event.



Fields in addition to [Common input fields](#common-input-fields):



| Field    | Type     | Meaning                                                                     |

| -------- | -------- | --------------------------------------------------------------------------- |

| `source` | `string` | How the session started: `startup`, `resume`, `clear`, `compact`, or `fork` |



A forked thread uses `source: "fork"`. Resuming a thread with supplied history

still uses `source: "resume"`.



Plain text on `stdout` is added as extra developer context.



JSON on `stdout` supports [Common output fields](#common-output-fields) and

this hook-specific shape:



```json

{

  "hookSpecificOutput": {

    "hookEventName": "SessionStart",

    "additionalContext": "Load the workspace conventions before editing."

  }

}

```



That `additionalContext` text is added as extra developer context.



After Codex compacts a root session, `SessionStart` hooks that match

`source: "compact"` run before the next model request. This also applies when

automatic compaction happens in the middle of a turn: Codex delivers the hook's

additional context to the immediate continuation instead of waiting for a

later user turn. If the hook returns `continue: false`, Codex ends the turn

without sending another model request.



```
