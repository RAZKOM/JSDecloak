// Smoke test for the new features:
//   - scopePath derivation
//   - scope-aware renameBinding + renameMap replay
//   - annotation key migration
//   - project file shape validation
//
// Run with: node scripts/smoke-new.mjs
// Uses jiti to load TS source directly.

import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(__dirname, { interopDefault: true });

const { renameBinding, listBindings, replayRenameMap } = await jiti.import(
  '../src/utils/rename.ts',
);
const { upsertAnnotation, migrateAnnotationOnRename, findAnnotation } = await jiti.import(
  '../src/utils/annotations.ts',
);
const { isProjectFile, normalizeProject, buildProjectFile } = await jiti.import(
  '../src/utils/projectFile.ts',
);

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}  ${detail}`); fail++; }
}

// --- 1. scopePath shows up on listBindings ---
console.log('\n[1] listBindings exposes scopePath');
{
  const src = `
    function outer(a) {
      var x = 1;
      function inner(b) {
        var x = 2;
        return x + b;
      }
      return inner(a);
    }
  `;
  const bindings = listBindings(src);
  const xs = bindings.filter((b) => b.name === 'x');
  check('two x bindings found', xs.length === 2, `got ${xs.length}`);
  const distinctPaths = new Set(xs.map((b) => b.scopePath));
  check('two distinct scope paths for x', distinctPaths.size === 2, `paths=${[...distinctPaths]}`);
  check('inner scopePath contains FunctionDeclaration[inner]',
    xs.some((b) => b.scopePath.includes('FunctionDeclaration[inner]')));
}

// --- 2. renameBinding with scopePath only touches that scope ---
console.log('\n[2] scope-targeted renameBinding isolates the right binding');
{
  const src = `
function outer(a) {
  var x = 1;
  function inner(b) {
    var x = 2;
    return x + b;
  }
  return x + inner(a);
}`;
  const bindings = listBindings(src);
  const innerX = bindings.find((b) => b.name === 'x' && b.scopePath.includes('FunctionDeclaration[inner]'));
  check('found inner x', !!innerX);

  const res = renameBinding(src, 'x', 'innerX', undefined, innerX.scopePath);
  check('rename succeeded', !res.error, res.error);
  check('output still has plain x (outer untouched)', /var x = 1/.test(res.code));
  check('output renamed inner x', /var innerX = 2/.test(res.code));
  check('inner return uses innerX', /return innerX \+ b/.test(res.code));
  check('outer return still uses x', /return x \+ inner/.test(res.code));
  check('renameBinding returned scopePath', res.scopePath === innerX.scopePath);
}

// --- 3. replayRenameMap survives a re-format ---
console.log('\n[3] replayRenameMap with scope-aware entries');
{
  const src1 = `function outer(a) { var x = 1; function inner(b) { var x = 2; return x + b; } return x + inner(a); }`;
  // Same logical code, slightly different formatting / line layout.
  const src2 = `
    function outer(a) {
      var x = 1;
      function inner(b) {
        var x = 2;
        return x + b;
      }
      return x + inner(a);
    }
  `;

  const bindings1 = listBindings(src1);
  const innerXPath = bindings1.find((b) => b.name === 'x' && b.scopePath.includes('FunctionDeclaration[inner]')).scopePath;
  const outerXPath = bindings1.find((b) => b.name === 'x' && !b.scopePath.includes('FunctionDeclaration[inner]')).scopePath;

  const map = [
    { from: 'x', to: 'innerX', scopePath: innerXPath },
    { from: 'x', to: 'outerX', scopePath: outerXPath },
  ];
  const report = replayRenameMap(src2, map);
  check('both entries applied', report.applied.length === 2, `applied=${report.applied.length}, skipped=${report.skipped.length}`);
  check('outer x renamed', /var outerX = 1/.test(report.code));
  check('inner x renamed', /var innerX = 2/.test(report.code));
}

// --- 4. legacy {from: to} replay still works via fallback ---
console.log('\n[4] legacy rename-map replay (no scopePath)');
{
  const src = `function foo(_0xa1b2) { return _0xa1b2 * 2; }`;
  const report = replayRenameMap(src, [{ from: '_0xa1b2', to: 'x' }]);
  check('applied 1', report.applied.length === 1);
  check('output renamed', /\(x\)/.test(report.code) && /return x \* 2/.test(report.code));
}

// --- 5. annotations: upsert, key by name+scopePath ---
console.log('\n[5] annotation store');
{
  let anns = [];
  anns = upsertAnnotation(anns, { name: 'x', scopePath: 'A', note: 'outer', ts: 1 });
  anns = upsertAnnotation(anns, { name: 'x', scopePath: 'B', note: 'inner', ts: 2 });
  check('two annotations stored', anns.length === 2);
  check('find by (name, scopePath) returns correct one',
    findAnnotation(anns, 'x', 'A').note === 'outer' && findAnnotation(anns, 'x', 'B').note === 'inner');

  // Empty note removes it.
  anns = upsertAnnotation(anns, { name: 'x', scopePath: 'A', note: '   ', ts: 3 });
  check('empty note removes annotation', anns.length === 1 && !findAnnotation(anns, 'x', 'A'));
}

// --- 6. annotation migrates on rename ---
console.log('\n[6] annotation migrates on rename');
{
  let anns = [
    { name: '_0xa1b2', scopePath: 'Program>FunctionDeclaration[foo]', note: 'the decoder', ts: 1 },
    { name: '_0xa1b2', scopePath: 'Program>FunctionDeclaration[bar]', note: 'unrelated', ts: 2 },
  ];
  anns = migrateAnnotationOnRename(anns, '_0xa1b2', 'decode', 'Program>FunctionDeclaration[foo]');
  check('renamed entry is now under new name', !!findAnnotation(anns, 'decode', 'Program>FunctionDeclaration[foo]'));
  check('other-scope annotation untouched', !!findAnnotation(anns, '_0xa1b2', 'Program>FunctionDeclaration[bar]'));
  check('total count unchanged', anns.length === 2);
}

// --- 7. project file validation ---
console.log('\n[7] project file validation');
{
  const cfg = { steps: [], engine: 'none', printWidth: 100, indentSize: 2, parseJsx: false, parseTypescript: false, includeAstTree: true, wakaruAggressive: false };
  const proj = buildProjectFile({ fileName: 'a.js', input: 'x', output: 'y', config: cfg, renames: [], annotations: [] });
  check('built project validates', isProjectFile(proj));
  check('kind is jsdecloak-project', proj.kind === 'jsdecloak-project');
  check('version is 1', proj.version === 1);

  check('rejects bad shape', !isProjectFile({ kind: 'something-else' }));
  check('rejects non-object', !isProjectFile(null) && !isProjectFile('hello'));

  // normalize survives missing optional fields
  const trimmed = { kind: 'jsdecloak-project', version: 1, input: '', output: '', config: cfg, renames: [], annotations: [] };
  const norm = normalizeProject(trimmed);
  check('normalize fills fileName=null', norm.fileName === null);
}

console.log(`\n${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
