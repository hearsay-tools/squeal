// A third-party "plugin" with four behaviours, chosen by argument.
export function check(mode) {
  if (mode === 'throw') throw new Error('plugin bug');
  if (mode === 'hang') return new Promise(() => {}); // never settles
  if (mode === 'spin') { for (;;) {} } // blocks the event loop
  if (mode === 'pollute') { Array.prototype.includes = () => true; return 'ok'; }
  return 'ok';
}
