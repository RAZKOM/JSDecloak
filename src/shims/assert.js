// Synchrony does `import assert from 'assert'` then calls `assert(condition)`.
// The `assert` npm package's ESM build sometimes wraps the default in a way
// that makes `assert.default` not a callable. We re-export it cleanly here.

import assertLib from 'assert';

function assertFn(value, message) {
  if (!value) {
    throw new Error(typeof message === 'string' ? message : 'Assertion failed');
  }
}

// Copy all static methods from the lib onto our callable.
const target = (assertLib && typeof assertLib === 'function') ? assertLib : assertFn;
if (assertLib && typeof assertLib === 'object') {
  for (const key of Object.keys(assertLib)) {
    try { target[key] = assertLib[key]; } catch { /* ignore */ }
  }
}
// Ensure essentials exist
target.ok = target.ok || ((v, m) => { if (!v) throw new Error(m || 'Assertion failed'); });
target.equal = target.equal || ((a, b, m) => { if (a != b) throw new Error(m || `${a} != ${b}`); });
target.strictEqual = target.strictEqual || ((a, b, m) => { if (a !== b) throw new Error(m || `${a} !== ${b}`); });
target.deepEqual = target.deepEqual || ((a, b, m) => { if (JSON.stringify(a) != JSON.stringify(b)) throw new Error(m || 'deepEqual failed'); });
target.notEqual = target.notEqual || ((a, b, m) => { if (a == b) throw new Error(m || `${a} == ${b}`); });
target.fail = target.fail || ((m) => { throw new Error(m || 'fail'); });

export default target;
export const ok = target.ok;
export const equal = target.equal;
export const strictEqual = target.strictEqual;
export const deepEqual = target.deepEqual;
export const deepStrictEqual = target.deepStrictEqual || target.deepEqual;
export const notEqual = target.notEqual;
export const fail = target.fail;
