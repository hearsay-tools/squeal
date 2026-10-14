# OpenCode plugins: findings

2026-10-14. OpenCode **1.18.35**, source tag `v1.18.35`, commit `53d1eabb61e21162157817bf677da0a4ad3332e3`; Linux, embedded **Bun 1.3.14**. Model probes used `cliproxy/gpt-6-luna` as OS user `squeal-e2e`. Evidence and reproduction: [probes/opencode-plugins/README.md](probes/opencode-plugins/README.md). No product changes.

## Questions answered

| Question | Answer and strongest evidence |
| --- | --- |
| 6. Runtime, failures, cost (tested first) | **verified by experiment**: `node:sqlite` is unavailable; Unix sockets and detached Node spawning work. A hanging async hook stalls its tool; HTTP health and abort still work. |
| 1. Extension surfaces | **read in source code**: automatically loaded local JS/TS plugin files avoid editing user config; npm entries also work through the loader. |
| 2. Hooks/events and identity | **verified by experiment**: before/after, message, model transforms and idle fire in both `run` and `serve`; inventory below. **read in source code**: child sessions have their own ID and `parentID`. |
| 3. Injection and primer | **verified by experiment**: mutable after-output, `noReply` synthetic text and system transform reach the model. A 32 KiB tail marker was read. |
| 4. Deny | **verified by experiment**: throwing before `apply_patch` prevents execution, exposes the reason and allows retry in the same turn. |
| 5. End of turn | **verified by experiment**: guarded idle continuation works under `serve`; `run` exits before that continuation completes. Abort also emits idle. |

## Findings per question

### 6. Runtime and failure modes

**verified by experiment, 1.18.35:** Dynamic `import("node:sqlite")` fails with `ResolveMessage: No such built-in module: node:sqlite`. This is the runtime inside an actual loaded plugin, not a separately installed Bun. `process.versions.node` misleadingly reports `24.3.0`; `process.execPath` is OpenCode's executable. `node:net` successfully serves/connects to a Unix socket. `node:child_process.spawn` with `detached: true`, ignored stdio and `unref()` starts an explicitly named Node 24 child which writes its marker. These imports do **not** establish that shared Squeal code works in-process: its SQLite import prevents that unchanged shape.

**verified by experiment, 1.18.35:** In the model-free runtime sample, 50 Unix connect/write/read/close echoes cost **0.203 ms p50 / 0.462 ms p95**; 30 empty Node subprocesses cost **24.69 ms / 28.26 ms**. Across samples socket p95 reached 3.08 ms and Node p95 31.93 ms. These are transport/startup floors, not Squeal delivery timings. In-process shared-store timing is **not determined, because its required import fails**. Real shared-handler subprocess cost and real daemon delivery cost are **not determined, because this probe implements neither adapter nor a delivery RPC**. Squeal's existing `src/core/daemon/protocol.ts` has liveness/control requests, not the `HarnessDelivery` methods.

**read in source code, 1.18.35:** `Plugin.trigger` awaits plugins sequentially without a timeout or catch. Slow hooks delay that operation; a never-resolving hook has no automatic deadline. Synchronous CPU/blocking calls occupy the Bun process, so wrapping an asynchronous operation in a deadline alone cannot bound them. Plugin import/init failures are caught and skipped; config/dispose errors are logged and ignored. Bus `event` callback promises are discarded, without rejection handling in that dispatch loop. The process-level effect of a rejected event callback is **not determined, because the probe did not throw there**.

**verified by experiment, 1.18.35:** A never-resolving `tool.execute.before` remained unfinished for three seconds; no tool-after fired. HTTP health still returned healthy, and health plus abort completed in **294 ms**. Abort produced `MessageAbortedError`, `session.error` and `session.idle`. Throwing before an ordinary tool becomes a model-visible tool error (Q4); it does not demonstrate safe failure behavior for system/message hooks.

### 1. Loading and trust

**read in source code, 1.18.35:** `config/plugin.ts` discovers both `plugin/` and `plugins/`, `*.{ts,js}`, under the project `.opencode` and global config directories. The loader dynamically imports modules, then invokes exported plugin functions (also supports the newer `{server, id}` module). TS works directly in the embedded Bun runtime. Inputs are `client`, `$` (Bun shell), `directory`, `worktree`, `project`, `serverUrl`, and `experimental_workspace`. The supplied client is scoped to the directory; it can use an in-process fetch when no HTTP server is listening.

**read in official docs, 1.18.35 tag:** Order is global config, project config, global plugin directory, project plugin directory. **read in source code, 1.18.35:** hooks register sequentially; additional config sources exist, and deduplication uses npm package **name**, or exact file URL, with the last entry winning. This is stricter than the docs' “same name and version” wording. No filename-order guarantee was established.

**read in source code, 1.18.35:** npm specs are resolved/installed before importing. Bare names become `@latest`. Contrary to this tag's docs (“Bun”, `~/.cache/opencode/node_modules`), `packages/core/src/npm.ts` uses `@npmcli/arborist` and cache directories under `Global.Path.cache/packages/`. Prefer the tagged implementation over that stale documentation. No separate lifecycle command-hook configuration or plugin approval gate was found in the config/loader paths. Slash commands and custom tools are distinct features, not command hooks.

**verified by experiment, 1.18.35:** `.opencode/plugins/probe.ts` loaded automatically with no plugin trust prompt in both modes. **inferred:** an adapter-owned `.opencode/plugins/squeal.js` (or global equivalent) is an installation surface that need not modify a user-owned config file; a name collision must still be handled. The plugin itself runs with host-user authority, outside tool permission checks.

### 2. Hooks, events and fields

**verified by experiment, 1.18.35:** Both base sessions fired `config`, `event`, `chat.message`, `chat.params`, `chat.headers`, `tool.definition`, `tool.execute.before`, `tool.execute.after`, `shell.env`, `experimental.chat.messages.transform`, `experimental.chat.system.transform`, `experimental.provider.small_model`, and `experimental.text.complete`. `dispose` was observed on `run` exit, not on the driver's SIGTERM of `serve`.

Both saw `session.created`, `session.updated`, `session.status`, `session.idle`, `session.diff`, `message.updated`, `message.part.updated`, `message.part.delta`, `file.edited`, `file.watcher.updated`, `plugin.added`, `catalog.updated`, `reference.updated`, and `integration.updated`. Explicit HTTP deletion additionally emitted `session.deleted`; the abort probe additionally emitted `session.error`. These are observed sets, not a claim that one short session exercises every event.

**read in source code, 1.18.35:** Remaining declared callable hooks are `permission.ask`, `command.execute.before`, `experimental.session.compacting`, `experimental.compaction.autocontinue`; none fired in the base probes. `permission.ask` has **no trigger call** in this source tree: use tool-before for denial. `tool`, `auth`, and `provider` are extension definitions, not ordinary invoked hooks. `session.compacted` exists but compaction was not exercised; its live behavior is **not determined, because these sessions did not fill context**.

**read in source code, 1.18.35:** before receives `{tool, sessionID, callID}` plus mutable `{args}`; after adds `args` to input and mutates `{title, output, metadata}`. Neither supplies a message ID or parent ID directly. `chat.message` supplies session ID and optional input message ID; its output contains the actual user message ID and parts. Params/headers carry session ID, agent, model/provider and user message; system-transform has optional session ID and model. `shell.env` has cwd and optional session/call IDs. Event callback gets `{id,type,properties}`; message parts carry session/message/part IDs, tool name, call ID and state. Session-info events carry directory and optional `parentID`; `file.edited` carries only file path. Plugin init supplies directory/worktree, not each event.

**read in source code, 1.18.35:** The `task` tool creates a child with `parentID=ctx.sessionID`; child calls use that child's ID. Look up session info or cache session-created events to distinguish them. Live child-tool observation is **not determined in this topic**, whose probes did not invoke `task`.

### 3. Mid-turn injection

**verified by experiment, 1.18.35:** Appending `PROBE_DELTA` to after-output made both base models report `DELTA_SEEN`. The next same-session `chat.params` ran **101–171 ms** later (four tool completions across `run`/`serve`); this measures local hook-to-request preparation, not provider latency. Throwing once did not interrupt that turn's later continuation. Appending 32,768 filler characters plus a tail instruction under `serve` yielded `LARGE_TAIL_SEEN`; this is a lower bound on usable payload size, not a maximum. Maximum size is **not determined, because it depends on model/context and no limit sweep was run**.

**verified by experiment, 1.18.35:** Calling `client.session.prompt({path:{id},body:{noReply:true,parts:[{type:"text",synthetic:true,text:...}]}})` inside after took **13.3 ms** and inserted a distinct user message. The next step reported `NOREPLY_SEEN`. **read in source code:** `noReply` saves the message and returns before entering the model loop; `synthetic` does not change its user role. The messages-transform hook can mutate the assembled history before a request, but injection through that hook was **not determined by experiment**. After-output is the simpler proven boundary and preserves tool-result provenance.

**verified by experiment, 1.18.35:** The system-transform primer made the model append `PRIMER_SEEN` in both modes. **read in source code:** it runs during request preparation, not just once at session creation, and also serves small-model requests. Config `instructions` and discovered `AGENTS.md` also populate system context; their model compliance was **not determined, because this probe used the transform**.

### 4. Denial

**verified by experiment, 1.18.35:** Throwing `PROBE_DENY: edit was not applied. Re-issue the edit once.` before the first `apply_patch` yielded an error tool part, no after-hook for that call, then a new call ID and successful edit. Only the successful retry emitted `file.edited`; both modes continued to their final answer without a new human prompt.

**read in source code, 1.18.35:** Built-in file mutation tools are `edit`, `write`, `apply_patch`; shell is `bash`. Registry selection exposes `apply_patch` for this GPT model and hides edit/write; other models can get those instead. Shell commands and plugin/MCP tools can also write, so that built-in list is not an exhaustive mutation detector. No built-in tool named `patch` was found.

### 5. Idle is an observation, not a blocking Stop

**verified by experiment, 1.18.35:** A `serve` plugin with a one-shot news guard called `client.session.prompt` on idle. It completed one additional response (`WAKE_SEEN`) in **2.56 s**; the second idle emitted no further prompt. Base sessions with no news made no extra turn. The abort probe also emitted idle, so idle alone cannot mean successful completion.

**verified by experiment, 1.18.35:** In `run`, idle triggered the same callback and its synthetic `chat.message`, but no subsequent model-parameter hook or second completed answer preceded disposal, **33 ms** after callback start. **read in source code:** `run.ts` breaks its event loop on the main session's idle status; event callbacks are not awaited as a Stop decision. Therefore do not promise a Stop-block continuation in this mode. Child idle uses the same session run-state/status code (**read in source code**); direct child-idle verification is **not determined here**.

## Recommendation for Squeal

**inferred from the evidence above:** Use a small auto-loaded plugin with an explicit Node bridge to reuse `src/harness/shared/`: system-transform for a conditional primer, chat-message for prompt boundaries, tool-after for deltas and tool-before for deny-once. Bound bridge execution and catch adapter faults; never use `process.execPath` as Node inside this runtime. A daemon RPC has lower transport overhead but would need a new delivery surface, contrary to assuming the current socket already provides it. Treat idle as turn-state evidence with abort handling; make any `serve` wake guarded and optional. For `run`, retain delivery at the next prompt/tool boundary rather than claim Stop parity. This is a recommendation, not a change to the spec's no-core-change decision.

## Open questions

Actual shared-handler p95 with store contention; subprocess cancellation/late delivery credit; bridge packaging; a guaranteed completion gate for `run`; child/session-resume behavior; synchronous plugin fault containment; compaction and maximum injection size. See the explicit “not determined” limits above. TUI behavior was not tested.

## Sources

All source links are pinned to [v1.18.35](https://github.com/sst/opencode/tree/v1.18.35), resolved to the commit above. Fetched files: `packages/plugin/src/index.ts`; `packages/opencode/src/plugin/{index,loader,shared}.ts`; `src/config/{config,plugin,paths}.ts`; `src/session/{tools,prompt,status,run-state,instruction}.ts`; `src/session/llm/request.ts`; `src/tool/{registry,task}.ts`; `src/cli/cmd/run.ts`; `packages/core/src/npm.ts`. Official docs snapshot: [`packages/web/src/content/docs/plugins.mdx`](https://github.com/sst/opencode/blob/v1.18.35/packages/web/src/content/docs/plugins.mdx), including the two discrepancies recorded above. Local comparison: spec 001 D9, spec 002 D3/D5, `src/core/types/delivery.ts`, `src/harness/{shared,codex}/`, `src/core/daemon/protocol.ts`. Probe records are linked at the top.
