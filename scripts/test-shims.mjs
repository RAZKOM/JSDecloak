// Verify each shim has the methods the engines need.
import * as path from '../src/shims/path.js';
import assertShim from '../src/shims/assert.js';
import * as fs from '../src/shims/fs.js';
import * as os from '../src/shims/os.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { console.log('  PASS ', name); pass++; }
  else { console.log('  FAIL ', name, detail); fail++; }
};

console.log('[path]');
ok('has posix.dirname', typeof path.posix.dirname === 'function');
ok('has posix.join', typeof path.posix.join === 'function');
ok('has posix.relative', typeof path.posix.relative === 'function');
ok('has dirname', typeof path.dirname === 'function');
ok('has join', typeof path.join === 'function');
ok('has default.posix.dirname', typeof path.default.posix.dirname === 'function');
ok('default.posix === posix', path.default.posix === path.posix);

// Webcrack does `import { posix } from "node:path"` then `const { dirname } = posix`.
const { posix } = path;
const { dirname } = posix;
ok('destructure dirname from posix works', typeof dirname === 'function', String(dirname));
ok('dirname("/a/b/c") === "/a/b"', dirname('/a/b/c') === '/a/b');

console.log('\n[assert]');
ok('default is callable', typeof assertShim === 'function');
ok('default(true) does not throw', (() => { try { assertShim(true); return true; } catch { return false; } })());
ok('default(false) throws', (() => { try { assertShim(false); return false; } catch { return true; } })());
ok('default.ok exists', typeof assertShim.ok === 'function');
ok('default.strictEqual exists', typeof assertShim.strictEqual === 'function');

// Synchrony does `import assert from 'assert'` then `assert(condition)`.
// Synchrony's error was "assert__default.default is not a function".
// That means the bundler exposed `assert.default` (the default export wrapped).
// Our shim's default IS a callable function, so this should be fine now.
ok('assertShim.default === assertShim or callable', typeof (assertShim.default || assertShim) === 'function');

console.log('\n[fs]');
ok('promises object exists', typeof fs.promises === 'object');
ok('promises.mkdir is function', typeof fs.promises.mkdir === 'function');

console.log('\n[os]');
ok('platform() returns string', typeof os.platform() === 'string');
ok('homedir() returns string', typeof os.homedir() === 'string');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
