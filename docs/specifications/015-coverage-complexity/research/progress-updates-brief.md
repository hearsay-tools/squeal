# Research brief 015-26: progress updates on a failing function

Use /researcher. Shape: research. Outcome: whether an agent should be able to subscribe to updates on a function over the complexity threshold, and if so, what the subscription is. The human decides whether it becomes a row. Follow the rules in `README.md`.

The human's idea (2026-10-24, `status.md`): after the one `STILL FAIL` that says Squeal stays quiet until the function is fixed, an agent that wants to see how each change moves the count could subscribe, for example `squeal code <command> <function>`, advertised in that line; an agent that knows its fix would not.

Read first: spec D6 with its 2026-10-24 amendments; `lessons.md` "Round 1, live sessions (015-10)" (sq3 is the failed fix attempt); `src/core/delivery/code-deliver.ts` and `src/cli/code.ts`; 011 C5 (views) and C6 (status).

Questions:

1. **Need.** In the 015-10 sessions, how often did an agent working on a function over the threshold call `squeal code` or re-read its count by hand? What would a subscription have told it, edit by edit?
2. **Key.** What the subscription names: a path, a function identity (qualified name and occurrence), or an id the `STILL FAIL` line prints. How it survives a rename, a move, or a split into two functions.
3. **Delivery.** Where updates go (the tool-boundary delivery, as code transitions do), what one says (the count now and before, one line), when one fires (an edit that changes the function's body), and how the subscription ends (at or under the threshold, an explicit stop, session end, a bound).
4. **Noise and cost.** Updates per subscribed fix attempt, estimated from the sessions; the cost per delivery; what an unsubscribed agent sees (only the longer `STILL FAIL` line).
5. **Peers.** Live feedback in Wallaby, SonarLint, CodeScene or others: what they show per edit on one function, and whether it is opt-in.

Own `progress-updates.md` and `probes/progress-updates/`.
