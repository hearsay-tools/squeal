# Research brief 016-04: harnesses and the adapter contract

Use /researcher. Shape: research. Outcome: which harnesses Squeal could reach next, through which extension points, and the smallest adapter a third party would write for each class of harness. Follow the rules in `README.md`. Squeal's own four adapters are 016-01's; read them only as far as you need to compare.

Read first: `docs/vision.md` principles 3 and 6; 011 C8 (hook contract) and C14's three operations; `docs/decisions/0003-delivery-model.md`; the research READMEs of 002, 008 and 009 for how each harness was studied.

Harnesses: Cursor (agent and CLI), Gemini CLI, GitHub Copilot (CLI and coding agent), Amp, Goose, Aider, Cline and Roo Code, Kiro, Windsurf, Zed (Agent Client Protocol), Factory Droid, Crush, OpenHands, Continue. Add others you find; say why.

Questions:

1. **Extension points.** For each harness, from docs and source: a hook after a tool that can add text to the model's context; a hook at the end of a turn that can continue it; injection at session start; a way to wake an idle agent; MCP support (tools, resources, subscriptions, notifications); packaging and install (plugins, a marketplace, a config file).
2. **Classes.** Group the harnesses by what they offer (hook scripts, an in-process extension, MCP only, none). For each class, which of C8's rules hold and which cannot.
3. **MCP.** Can an MCP server push a delta that reaches the model's context, in which clients, and at which boundary? Is pull through an MCP tool plus push through a hook enough?
4. **Convergence.** Is there a shared hooks format or a standard forming across harnesses (hooks, ACP, AGENTS.md)? Name who backs it.
5. **Third parties.** What an outside author would need to ship an adapter: an SDK, a conformance kit (like Squeal's scratch-home proofs), documentation. Name a harness integration ecosystem that has such a kit.

Own `harness-landscape.md` and `probes/harness-landscape/`.
