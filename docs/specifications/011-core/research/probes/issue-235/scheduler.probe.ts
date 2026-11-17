import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

// Throwaway research probe. Source root can be a local release-tag snapshot.
const root = resolve(process.env.PROBE_SOURCE_ROOT ?? '.');
const source = (path: string) => pathToFileURL(resolve(root, path)).href;
const { started, importers, FOUR_SHORT } = await import(source('test/scheduler/edit-cut-fixture.ts'));
const { settle } = await import(source('test/scheduler/tier-yields-fixture.ts'));
const { publishedWaits } = await import(source('src/core/scheduler/quiet.ts'));
const { narrowText } = await import(source('src/cli/run-group-narrow.ts'));
const { groupView } = await import(source('src/core/scheduler/slow.ts'));
const { DEFAULT_POLICY } = await import(source('src/core/types/policy.ts'));
const A = 'src/a.ts';
const own = { path: 'src/a.test.ts', ms: 900, imports: [A] };
const direct = importers('d', A, FOUR_SHORT);
const selected = direct[4].path;
const unrelated = direct[5].path;
const files = [own, ...direct];

for (const control of [false, true]) {
  it(control ? 'promotion control isolates the selected file' : 'narrow request remains behind quiet', async () => {
    const { side } = await started(files, { clock: 'virtual', lane: () => 'vitest', hostSlots: 2 });
    await side.edit('watch', A);
    await settle(side);
    const afterEdit = side.runner.runs.length;
    expect(side.current(selected)).toBe(false);
    expect(side.current(unrelated)).toBe(false);
    const request = await side.scheduler.requestGroupPaths('tests', [own.path, direct[0].path, selected]);
    expect(request.narrow.current).toBe(2);
    expect(request.queued).toBe(1);
    const group = groupView(DEFAULT_POLICY).groups.find((g: { name: string }) => g.name === 'tests');
    const text = narrowText(group, request, request.narrow, 'squeal').trim();
    if (control) await side.scheduler.promote([{ project: '', path: selected }], 60000);
    await settle(side);
    const snapshot = () => ({ selectedCurrent: side.current(selected), unrelatedCurrent: side.current(unrelated),
      newRuns: side.runner.runs.slice(afterEdit).map((r: { files: {path:string}[] }) => r.files.map(f => f.path)),
      quietRemainingMs: [...publishedWaits(side.store, side.worktreeId, 0, side.now()).catchUp.values()].map((t: number) => t - side.now()) });
    console.log(JSON.stringify({ control, atMs: 0, text, ...snapshot() }));
    expect(side.current(selected)).toBe(control);
    expect(side.current(unrelated)).toBe(false);
    side.advance(60000);
    await settle(side);
    console.log(JSON.stringify({ control, atMs: 60000, ...snapshot() }));
    expect(side.current(selected)).toBe(control);
    expect(side.current(unrelated)).toBe(false);
    side.advance(60000);
    await settle(side);
    console.log(JSON.stringify({ control, atMs: 120000, ...snapshot() }));
    expect(side.current(selected)).toBe(true);
    expect(side.current(unrelated)).toBe(true);
  });
}
