// Task 011-122: applies the probe to a copy of the tree. Usage: node instrument.mjs <probe-root>
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("usage: instrument.mjs <root>");
copyFileSync(join(dirname(new URL(import.meta.url).pathname), "probe.ts"), join(root, "src/core/probe.ts"));

function patch(file, edits) {
  const path = join(root, file);
  let text = readFileSync(path, "utf8");
  const depth = file.split("/").length - 3; // src/core/<dir>/x.ts -> 1
  const imp = `import { probe, since, where } from "${depth <= 0 ? "./" : "../".repeat(depth)}probe.js";\n`;
  text = imp + text;
  for (const [from, to] of edits) {
    const n = text.split(from).length - 1;
    if (n !== 1) throw new Error(`${file}: ${n} matches for ${JSON.stringify(from.slice(0, 60))}`);
    text = text.replace(from, () => to);
  }
  writeFileSync(path, `// biome-ignore-all lint: probe\n${text}`);
  console.log("patched", relative(root, path));
}

patch("src/core/store/connection.ts", [
  [
    `    return Number(this.#depth > 0 ? changes() : this.#withinSlice(changes));`,
    `    if (this.#depth > 0) return Number(changes());
    const probeT0 = performance.now();
    try {
      const out = Number(this.#withinSlice(changes));
      probe("run", { ms: since(probeT0), slice: currentSlice(), at: where() });
      return out;
    } catch (error) {
      probe("run-failed", { ms: since(probeT0), slice: currentSlice(), at: where(), error: String(error).slice(0, 60) });
      throw error;
    }`,
  ],
  [
    `    if (savepoint === null) this.#withinSlice(() => this.db.exec("BEGIN IMMEDIATE"));
    else this.db.exec(\`SAVEPOINT \${savepoint}\`);
    this.#depth++;
    try {
      const result = fn();
      this.db.exec(savepoint === null ? "COMMIT" : \`RELEASE \${savepoint}\`);
      return result;`,
    `    const probeT0 = performance.now();
    if (savepoint === null) {
      try {
        this.#withinSlice(() => this.db.exec("BEGIN IMMEDIATE"));
      } catch (error) {
        probe("tx-busy", { waitMs: since(probeT0), slice: currentSlice(), at: where(), error: String(error).slice(0, 60) });
        throw error;
      }
    } else this.db.exec(\`SAVEPOINT \${savepoint}\`);
    const probeT1 = performance.now();
    this.#depth++;
    try {
      const result = fn();
      const probeT2 = performance.now();
      this.db.exec(savepoint === null ? "COMMIT" : \`RELEASE \${savepoint}\`);
      if (savepoint === null) probe("tx", { waitMs: since(probeT0, probeT1), bodyMs: since(probeT1, probeT2), commitMs: since(probeT2), slice: currentSlice(), at: where() });
      return result;`,
  ],
  [
    `const slices = new AsyncLocalStorage<Slice>();`,
    `const slices = new AsyncLocalStorage<Slice>();
function currentSlice(): number | null {
  const slice = slices.getStore();
  return slice !== undefined && slice.live ? slice.ms : null;
}`,
  ],
]);

patch("src/core/watcher/change-feed.ts", [
  [
    `  private onDebounced(paths: AbsolutePath[]): void {
    void this.enqueue(
      async () => {`,
    `  private onDebounced(paths: AbsolutePath[]): void {
    probe("feed-debounced", { paths: paths.length });
    void this.enqueue(
      async () => {
        probe("feed-batch-start");`,
  ],
  [
    `      } catch (error) {
        const pass = retryAs && (() => this.reconcileNow(retryAs()));`,
    `      } catch (error) {
        probe("feed-task-failed", { error: String(error).slice(0, 60) });
        const pass = retryAs && (() => this.reconcileNow(retryAs()));`,
  ],
  [
    `  private async reconcileNow(trigger: RevisionTrigger): Promise<void> {
    const status = await gitStatus(this.root);
    await this.rebuildSpec(status);
    const { paths, linkedDirs, links } = await candidatesForReconcile(this.context(), status.paths);
    this.linkTargets = new Map(links);
    await this.linked?.update(linkedDirs);
    await this.emit({ trigger, paths: this.tempHold.filter(paths, this.trackedPaths) });`,
    `  private async reconcileNow(trigger: RevisionTrigger): Promise<void> {
    const p0 = performance.now();
    probe("rec-start", { trigger });
    const status = await gitStatus(this.root);
    const p1 = performance.now();
    await this.rebuildSpec(status);
    const p2 = performance.now();
    const { paths, linkedDirs, links } = await candidatesForReconcile(this.context(), status.paths);
    const p3 = performance.now();
    this.linkTargets = new Map(links);
    await this.linked?.update(linkedDirs);
    const p4 = performance.now();
    probe("rec-emit", { trigger, gitStatusMs: since(p0, p1), specMs: since(p1, p2), candidatesMs: since(p2, p3), linkedMs: since(p3, p4), paths: paths.length });
    await this.emit({ trigger, paths: this.tempHold.filter(paths, this.trackedPaths) });`,
  ],
]);

patch("src/core/watcher/batch-retry.ts", [
  [
    `    for (let attempt = 0; ; attempt++) {
      await this.#pause(retry.delayMs(attempt));
      if (this.#closed) return;
      try {
        await pass();
        retry.ran();
        return;
      } catch (again) {
        const failure = toError(again);`,
    `    for (let attempt = 0; ; attempt++) {
      const delay = retry.delayMs(attempt);
      const p0 = performance.now();
      await this.#pause(delay);
      probe("retry-pass", { attempt, delay, pausedMs: since(p0) });
      if (this.#closed) return;
      const p1 = performance.now();
      try {
        await pass();
        probe("retry-landed", { attempt, passMs: since(p1) });
        retry.ran();
        return;
      } catch (again) {
        const failure = toError(again);
        probe("retry-failed", { attempt, passMs: since(p1), error: failure.message.slice(0, 60) });`,
  ],
]);

patch("src/core/scheduler/scheduler.ts", [
  [
    `    if (this.#closed || this.#reinstalled) return;
    await this.#lock.run(async () => {
      if (this.#reinstalled) return;
      const { context, ledger } = this.#started();`,
    `    if (this.#closed || this.#reinstalled) return;
    const h0 = performance.now();
    probe("hb-enter", { trigger: batch.trigger, paths: batch.paths.length, slice: sliceMs ?? null });
    await this.#lock.run(async () => {
      probe("hb-locked", { lockWaitMs: since(h0) });
      if (this.#reinstalled) return;
      const { context, ledger } = this.#started();`,
  ],
  [
    `      const pass = () => this.#pass(context, ledger, batch);
      await (sliceMs === undefined ? pass() : withBusySlice(sliceMs, pass));
    });`,
    `      const pass = () => this.#pass(context, ledger, batch);
      const h1 = performance.now();
      try {
        await (sliceMs === undefined ? pass() : withBusySlice(sliceMs, pass));
        probe("hb-pass-done", { passMs: since(h1), totalMs: since(h0) });
      } catch (error) {
        probe("hb-pass-failed", { passMs: since(h1), totalMs: since(h0), error: String(error).slice(0, 60) });
        throw error;
      }
    });`,
  ],
  [
    `    // Another worktree's heal may have left a file held here (review wave 13i, B1).
    if (ledger.confirmHeld()) ledger.commit();`,
    `    const q0 = performance.now();
    // Another worktree's heal may have left a file held here (review wave 13i, B1).
    if (ledger.confirmHeld()) ledger.commit();
    const q1 = performance.now();`,
  ],
  [
    `    this.#adopt(context, ledger);
    const { applied, touched } = await reconcileBatch(context, ledger, batch);`,
    `    this.#adopt(context, ledger);
    const q2 = performance.now();
    const { applied, touched } = await reconcileBatch(context, ledger, batch);
    probe("pass-phases", { confirmHeldMs: since(q0, q1), adoptMs: since(q1, q2), reconcileBatchMs: since(q2), revision: applied?.revision.number ?? null, createdAt: applied?.revision.createdAt ?? null });`,
  ],
  [
    `          const ended = await this.#ended(tier, ran, installStamp, slow, held);
          record = await this.#lock.run(() => this.#record(ended, true));`,
    `          const ended = await this.#ended(tier, ran, installStamp, slow, held);
          const r0 = performance.now();
          probe("tier-record-wait", { files: tier.files.length });
          record = await this.#lock.run(() => {
            probe("tier-record-locked", { lockWaitMs: since(r0) });
            return this.#record(ended, true);
          });
          probe("tier-recorded", { ms: since(r0) });`,
  ],
  [
    `      } catch (error) {
        this.#stall(error, \`\${plural(tier.files.length, "file")} of a tier queued again\`);`,
    `      } catch (error) {
        probe("tier-stall", { error: String(error).slice(0, 60) });
        this.#stall(error, \`\${plural(tier.files.length, "file")} of a tier queued again\`);`,
  ],
  [
    `    const flight: InFlight = { tier, done: Promise.resolve(), ran: false, held };`,
    `    const flight: InFlight = { tier, done: Promise.resolve(), ran: false, held };
    probe("tier-fly", { files: tier.files.length, lane: tier.lane });`,
  ],
]);

patch("src/core/scheduler/batch.ts", [
  [
    `  let diff = await diffBatch(batch, keys.cache, hasher);
  if (batch.trigger !== "watch") {
    const moved = diff.changes.length === 0 ? await keys.lockfileCandidates() : [];
    diff = await diffBeside(context, diff, batch, moved);
  }
  const head = diff.changes.length > 0 ? await context.head() : null;`,
    `  const b0 = performance.now();
  let diff = await diffBatch(batch, keys.cache, hasher);
  const b1 = performance.now();
  if (batch.trigger !== "watch") {
    const moved = diff.changes.length === 0 ? await keys.lockfileCandidates() : [];
    diff = await diffBeside(context, diff, batch, moved);
  }
  const b2 = performance.now();
  const head = diff.changes.length > 0 ? await context.head() : null;
  probe("batch-phases", { diffMs: since(b0, b1), besideMs: since(b1, b2), headMs: since(b2), changes: diff.changes.length, updates: diff.updates.length });`,
  ],
]);

patch("src/core/daemon/sliced-writes.ts", [
  [
    `    for (const [step, fn] of steps) {
      try {
        if (waits === undefined) fn();
        else withBusySliceSync(BUSY_SLICE_MS, fn);
      } catch (error) {`,
    `    for (const [step, fn] of steps) {
      const s0 = performance.now();
      try {
        if (waits === undefined) fn();
        else withBusySliceSync(BUSY_SLICE_MS, fn);
        probe("sliced-step", { what, step, ms: since(s0) });
      } catch (error) {
        probe("sliced-step-failed", { what, step, ms: since(s0), error: String(error).slice(0, 60) });`,
  ],
]);

patch("src/core/scheduler/busy-resume.ts", [
  [
    `    this.#waiting = true;
    this.#waits.waiting(PUMP, what);
    if (this.#timer !== null) return;
    this.#timer = setTimeout(
      () => {
        this.#timer = null;
        this.#resume();
      },`,
    `    this.#waiting = true;
    this.#waits.waiting(PUMP, what);
    probe("pump-gave-up", { what, attempts: this.#attempts });
    if (this.#timer !== null) return;
    this.#timer = setTimeout(
      () => {
        this.#timer = null;
        probe("pump-resume");
        this.#resume();
      },`,
  ],
  [
    `    if (!this.#waiting) return;
    this.#waiting = false;
    this.#attempts = 0;
    this.#waits.ran(PUMP);`,
    `    if (!this.#waiting) return;
    probe("pump-landed");
    this.#waiting = false;
    this.#attempts = 0;
    this.#waits.ran(PUMP);`,
  ],
]);

patch("src/core/store/busy.ts", [
  [
    `  waiting(key: string, what?: string): void {
    this.#since ??= this.#options.now();`,
    `  waiting(key: string, what?: string): void {
    probe("busy-waiting", { key, what: what ?? null, first: this.#since === null });
    this.#since ??= this.#options.now();`,
  ],
  [
    `  ran(key: string, what?: string): void {
    if (!this.#waiting.delete(key)) return;`,
    `  ran(key: string, what?: string): void {
    if (!this.#waiting.delete(key)) return;
    probe("busy-ran", { key, what: what ?? null, left: [...this.#waiting] });`,
  ],
  [
    `    if (waited.length > 0) this.#options.note(busyNote(waitedMs, waited));`,
    `    probe("busy-episode-end", { waitedMs, waited });
    if (waited.length > 0) this.#options.note(busyNote(waitedMs, waited));`,
  ],
]);

patch("src/core/daemon-loop/head.ts", [
  [
    `  const [sha, status] = await Promise.all([`,
    `  const g0 = performance.now();
  const [sha, status] = await Promise.all([`,
  ],
  [
    `  const head = sha.trim();`,
    `  probe("read-head", { ms: since(g0) });
  const head = sha.trim();`,
  ],
]);
