// Quick smoke test of the pure-logic pieces (no worker, no monaco).
// Run with: node --experimental-vm-modules scripts/smoke.mjs

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import jsBeautify from 'js-beautify';

const traverse = _traverse.default ?? _traverse;
const generate = _generate.default ?? _generate;

const SAMPLE = `var _0x4f2a=['log','from\\x20wakaru','init','random'];(function(_0x1a2b,_0x3c4d){var _0x5e6f=function(_0x7g8h){while(--_0x7g8h){_0x1a2b['push'](_0x1a2b['shift']());}};_0x5e6f(++_0x3c4d);}(_0x4f2a,0x1f3));var _0x9i0j=function(_0xkl1m,_0xno2p){_0xkl1m=_0xkl1m-0x0;var _0xqr3s=_0x4f2a[_0xkl1m];return _0xqr3s;};function _0xa1b2(_0xc3d4){var _0xe5f6=Math[_0x9i0j('0x3')]();console[_0x9i0j('0x0')](_0x9i0j('0x2'),_0xc3d4,_0xe5f6);return _0xe5f6*_0xc3d4;}_0xa1b2(0xa);`;

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}  ${detail}`); fail++; }
}

console.log('\n[1] format with js-beautify');
const formatted = jsBeautify.js_beautify(SAMPLE, { indent_size: 2, wrap_line_length: 100, end_with_newline: true });
check('formatted longer than original', formatted.length > SAMPLE.length, `${SAMPLE.length} -> ${formatted.length}`);
check('contains newlines', formatted.includes('\n'));

console.log('\n[2] babel parse');
let ast;
try {
  ast = parse(formatted, { sourceType: 'unambiguous', errorRecovery: true });
  check('parse ok', true);
} catch (e) {
  check('parse ok', false, e.message);
}

console.log('\n[3] symbol enumeration');
let varCount = 0, fnCount = 0, strCount = 0;
const seen = new Set();
traverse(ast, {
  Scope(path) {
    for (const name of Object.keys(path.scope.bindings)) {
      const b = path.scope.bindings[name];
      const loc = b.identifier.loc;
      if (!loc) continue;
      const key = `${name}@${loc.start.line}:${loc.start.column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      varCount++;
    }
  },
  StringLiteral() { strCount++; },
  Function() { fnCount++; },
});
check('found bindings', varCount > 5, `bindings=${varCount}`);
check('found strings', strCount > 3, `strings=${strCount}`);
check('found functions', fnCount >= 3, `functions=${fnCount}`);

console.log('\n[4] scope-aware rename (_0xa1b2 -> computeRandom)');
let renamedScope = null;
traverse(ast, {
  Identifier(path) {
    if (path.node.name === '_0xa1b2' && !renamedScope) {
      const b = path.scope.getBinding('_0xa1b2');
      if (b) renamedScope = b.scope;
    }
  },
});
let renamedOK = false;
let renamedCount = 0;
if (renamedScope) {
  const binding = renamedScope.getBinding('_0xa1b2');
  renamedCount = binding ? binding.references + 1 : 0;
  renamedScope.rename('_0xa1b2', 'computeRandom');
  renamedOK = true;
}
check('found _0xa1b2 binding', renamedOK);
check('binding has refs', renamedCount >= 2, `refs=${renamedCount}`);

const out = generate(ast, { compact: false }).code;
check('output contains new name', out.includes('computeRandom'), '');
check('output no longer contains old name', !out.includes('_0xa1b2'), '');

console.log('\n[5] obfuscation scoring sanity');
function score(name) {
  if (/^_0x[a-f0-9]{3,}$/i.test(name)) return 1.0;
  if (/^[a-zA-Z]$/.test(name)) return 0.3;
  return 0;
}
check('_0x4f2a flagged', score('_0x4f2a') === 1.0);
check('foo not flagged', score('foo') === 0);
check('single char low score', score('i') === 0.3);

console.log(`\n${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
