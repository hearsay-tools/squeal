// Independent research prototype of Testmon's structural idea, not copied code.
import { parse } from 'acorn';
import { createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([k]) => !['start', 'end', 'raw'].includes(k)).map(([k, v]) => [k, canonical(v)]));
  return value;
};
export function structure(code) {
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const bodies = new Map();
  const skeleton = canonical(ast);
  ast.body.forEach((statement, i) => {
    const fn = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (fn?.type !== 'FunctionDeclaration' || !fn.id || !fn.body) return;
    if (bodies.has(fn.id.name)) throw new Error('duplicate declaration');
    bodies.set(fn.id.name, { start: fn.start, end: fn.end, hash: hash(JSON.stringify(canonical(fn.body))) });
    const destination = statement.type === 'ExportNamedDeclaration' ? skeleton.body[i].declaration : skeleton.body[i];
    destination.body = '<body>';
  });
  return { skeleton: hash(JSON.stringify(skeleton)), bodies };
}
export function selected({ previous, next, records, source = 'rates.mjs', guarded = true, epoch = 'one' }) {
  const old = structure(previous[source]);
  let fresh;
  try { fresh = structure(next[source]); }
  catch { return { tests: records.map(r => r.test), reasons: ['parse failure'] }; }
  const changes = Object.keys({ ...previous, ...next }).filter(p => previous[p] !== next[p]);
  const tests = [];
  const reasons = [];
  for (const record of records) {
    let reason;
    const evidence = record.coverage.find(s => s.url.endsWith(`/${source}`));
    if (guarded && (record.sourceHash !== hash(previous[source]) || record.epoch !== epoch || record.failure)) reason = 'unusable evidence';
    else if (guarded && changes.some(p => p !== source && record.inputs.includes(p))) reason = 'other input changed';
    else if (guarded && changes.some(p => record.childInputs?.includes(p))) reason = 'observed child module: keep whole source';
    else if (guarded && record.observations.child && changes.length) reason = 'observed child: keep whole closure';
    else if (guarded && record.observations.reflection && changes.includes(source)) reason = 'observed reflection: keep raw source';
    else if (!evidence) reason = 'missing source coverage';
    else if (old.skeleton !== fresh.skeleton) reason = 'module structure changed';
    else {
      for (const [name, body] of old.bodies) {
        const changed = body.hash !== fresh.bodies.get(name)?.hash;
        if (!changed) continue;
        const coverage = evidence.functions.find(fn => fn.ranges[0].startOffset === body.start && fn.ranges[0].endOffset === body.end);
        // Missing exact ranges are not an unexecuted function.
        if (!coverage || coverage.ranges[0].count > 0) { reason = coverage ? `executed body: ${name}` : `unmapped body: ${name}`; break; }
      }
    }
    if (reason) { tests.push(record.test); reasons.push(`${record.test}: ${reason}`); }
  }
  return { tests, reasons };
}
