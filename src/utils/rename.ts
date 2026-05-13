import { parse } from '@babel/parser';
import _traverse, { type NodePath, type Scope } from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';
import type { File as BabelFile } from '@babel/types';
import { scopePathOf } from './scopePath';

const traverse = (_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse;
const generate = (_generate as unknown as { default?: typeof _generate }).default ?? _generate;

type BabelLoc = NonNullable<t.Identifier['loc']>;

function positionInIdentifierLoc(
  loc: BabelLoc,
  pos: { line: number; column: number },
): boolean {
  const { line, column } = pos;
  const s = loc.start;
  const e = loc.end;
  if (line < s.line || line > e.line) return false;
  if (s.line === e.line) {
    return line === s.line && column >= s.column && column < e.column;
  }
  if (line === s.line) return column >= s.column;
  if (line === e.line) return column < e.column;
  return line > s.line && line < e.line;
}

function classDeclOrExprParent(
  path: NodePath,
): NodePath<t.ClassDeclaration | t.ClassExpression> | null {
  const p = path.findParent(
    (q) => q.isClassDeclaration() || q.isClassExpression(),
  ) as NodePath<t.ClassDeclaration | t.ClassExpression> | null;
  return p ?? null;
}

function classHasInstanceMethodNamed(
  classPath: NodePath<t.ClassDeclaration | t.ClassExpression>,
  name: string,
): boolean {
  let ok = false;
  classPath.get('body').traverse({
    ClassMethod(m) {
      const k = m.node.key;
      if (t.isIdentifier(k) && k.name === name && !m.node.computed) ok = true;
    },
  });
  return ok;
}

function isClassDeclarationSelfBinding(scopePath: NodePath, bindingPath: NodePath): boolean {
  return scopePath.isClassDeclaration() && bindingPath === scopePath;
}

function renameClassInstancePropertyAst(
  classPath: NodePath<t.ClassDeclaration | t.ClassExpression>,
  oldName: string,
  newName: string,
): { renamed: number; classScopePath: string } {
  let renamed = 0;
  const classScopePath = scopePathOf(classPath.scope);

  classPath.get('body').traverse({
    MemberExpression(memberPath) {
      if (memberPath.node.computed) return;
      const prop = memberPath.node.property;
      if (!t.isIdentifier(prop) || prop.name !== oldName) return;
      if (!t.isThisExpression(memberPath.node.object)) return;
      prop.name = newName;
      renamed += 1;
    },
  });

  return { renamed, classScopePath };
}

function tryRenameClassInstanceProperty(
  ast: BabelFile,
  oldName: string,
  newName: string,
  position: { line: number; column: number },
  originalCode: string,
): RenameResult | null {
  let classPath: NodePath<t.ClassDeclaration | t.ClassExpression> | null = null;

  traverse(ast, {
    Identifier(path) {
      if (classPath) return;
      if (path.node.name !== oldName) return;
      const loc = path.node.loc;
      if (!loc || !positionInIdentifierLoc(loc, position)) return;

      if (
        t.isMemberExpression(path.parent) &&
        path.parent.property === path.node &&
        !path.parent.computed &&
        t.isThisExpression(path.parent.object)
      ) {
        const cp = classDeclOrExprParent(path);
        if (!cp) return;
        if (classHasInstanceMethodNamed(cp, oldName)) return;
        classPath = cp;
        path.stop();
      }
    },
  });

  if (!classPath) return null;

  const { renamed, classScopePath } = renameClassInstancePropertyAst(classPath, oldName, newName);
  if (renamed === 0) return null;

  const out = generate(ast, { retainLines: true, compact: false, jsescOption: { minimal: true } }, originalCode);
  return { code: out.code, renamed, scopePath: classScopePath };
}

function tryRenameClassInstancePropertyByScopePath(
  ast: BabelFile,
  oldName: string,
  newName: string,
  targetScopePath: string,
  originalCode: string,
): RenameResult | null {
  let classPath: NodePath<t.ClassDeclaration | t.ClassExpression> | null = null;

  traverse(ast, {
    ClassDeclaration(p) {
      if (scopePathOf(p.scope) !== targetScopePath) return;
      classPath = p as NodePath<t.ClassDeclaration>;
    },
    ClassExpression(p) {
      if (scopePathOf(p.scope) !== targetScopePath) return;
      classPath = p as NodePath<t.ClassExpression>;
    },
  });

  if (!classPath) return null;

  const { renamed, classScopePath } = renameClassInstancePropertyAst(classPath, oldName, newName);
  if (renamed === 0) return null;

  const out = generate(ast, { retainLines: true, compact: false, jsescOption: { minimal: true } }, originalCode);
  return { code: out.code, renamed, scopePath: classScopePath };
}

function renameClassInstanceMethodAst(
  classPath: NodePath<t.ClassDeclaration | t.ClassExpression>,
  oldName: string,
  newName: string,
): { renamed: number; methodScopePath?: string } {
  let renamed = 0;
  let methodScopePath: string | undefined;

  classPath.get('body').traverse({
    ClassMethod(methodPath) {
      const key = methodPath.node.key;
      if (t.isIdentifier(key) && key.name === oldName && !methodPath.node.computed) {
        key.name = newName;
        renamed += 1;
        if (methodScopePath === undefined) {
          methodScopePath = scopePathOf(methodPath.scope);
        }
      }
    },
    MemberExpression(memberPath) {
      if (memberPath.node.computed) return;
      const prop = memberPath.node.property;
      if (!t.isIdentifier(prop) || prop.name !== oldName) return;
      if (!t.isThisExpression(memberPath.node.object)) return;
      prop.name = newName;
      renamed += 1;
    },
  });

  return { renamed, methodScopePath };
}

function tryRenameClassInstanceMethod(
  ast: BabelFile,
  oldName: string,
  newName: string,
  position: { line: number; column: number },
  originalCode: string,
): RenameResult | null {
  let classPath: NodePath<t.ClassDeclaration | t.ClassExpression> | null = null;

  traverse(ast, {
    Identifier(path) {
      if (classPath) return;
      if (path.node.name !== oldName) return;
      const loc = path.node.loc;
      if (!loc || !positionInIdentifierLoc(loc, position)) return;

      if (t.isClassMethod(path.parent) && path.parent.key === path.node && !path.parent.computed) {
        classPath = classDeclOrExprParent(path);
        if (classPath) path.stop();
        return;
      }

      if (
        t.isMemberExpression(path.parent) &&
        path.parent.property === path.node &&
        !path.parent.computed &&
        t.isThisExpression(path.parent.object)
      ) {
        const cp = classDeclOrExprParent(path);
        if (cp && classHasInstanceMethodNamed(cp, oldName)) {
          classPath = cp;
          path.stop();
        }
      }
    },
  });

  if (!classPath) return null;

  const { renamed, methodScopePath } = renameClassInstanceMethodAst(classPath, oldName, newName);
  if (renamed === 0) return null;

  const out = generate(ast, { retainLines: true, compact: false, jsescOption: { minimal: true } }, originalCode);
  return { code: out.code, renamed, scopePath: methodScopePath };
}

function tryRenameClassInstanceMethodByScopePath(
  ast: BabelFile,
  oldName: string,
  newName: string,
  targetScopePath: string,
  originalCode: string,
): RenameResult | null {
  let classPath: NodePath<t.ClassDeclaration | t.ClassExpression> | null = null;

  traverse(ast, {
    ClassMethod(methodPath) {
      const key = methodPath.node.key;
      if (!t.isIdentifier(key) || key.name !== oldName || methodPath.node.computed) return;
      if (scopePathOf(methodPath.scope) !== targetScopePath) return;
      const cp = classDeclOrExprParent(methodPath);
      if (cp) classPath = cp;
    },
  });

  if (!classPath) return null;

  const { renamed, methodScopePath } = renameClassInstanceMethodAst(classPath, oldName, newName);
  if (renamed === 0) return null;

  const out = generate(ast, { retainLines: true, compact: false, jsescOption: { minimal: true } }, originalCode);
  return { code: out.code, renamed, scopePath: methodScopePath };
}

export interface RenameResult {
  code: string;
  renamed: number;
  scopePath?: string;
  error?: string;
}

export function renameBinding(
  code: string,
  oldName: string,
  newName: string,
  position?: { line: number; column: number },
  targetScopePath?: string,
): RenameResult {
  if (!newName.trim() || newName === oldName) {
    return { code, renamed: 0, error: 'invalid new name' };
  }
  if (!/^[A-Za-z_$][\w$]*$/.test(newName)) {
    return { code, renamed: 0, error: 'identifier must match /^[A-Za-z_$][\\w$]*$/' };
  }

  let ast;
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
      errorRecovery: true,
      plugins: ['jsx', 'typescript'],
    });
  } catch (e) {
    return { code, renamed: 0, error: `parse failed: ${e instanceof Error ? e.message : e}` };
  }

  let targetScope: Scope | null = null;
  let targetPath: string | undefined;

  traverse(ast, {
    Identifier(path: NodePath<t.Identifier>) {
      if (path.node.name !== oldName) return;
      if (targetScope) return;
      const binding = path.scope.getBinding(oldName);
      if (!binding) return;

      const bindingScopePath = scopePathOf(binding.scope);

      if (targetScopePath) {
        if (bindingScopePath !== targetScopePath) return;
      } else if (position) {
        const loc = path.node.loc;
        if (!loc || !positionInIdentifierLoc(loc, position)) return;
      }

      targetScope = binding.scope;
      targetPath = bindingScopePath;
    },
  });

  if (!targetScope && targetScopePath) {
    const byPath = tryRenameClassInstanceMethodByScopePath(ast, oldName, newName, targetScopePath, code);
    if (byPath) return byPath;
    const byPropPath = tryRenameClassInstancePropertyByScopePath(ast, oldName, newName, targetScopePath, code);
    if (byPropPath) return byPropPath;
  }

  if (!targetScope && position) {
    const cm = tryRenameClassInstanceMethod(ast, oldName, newName, position, code);
    if (cm) return cm;
    const ip = tryRenameClassInstanceProperty(ast, oldName, newName, position, code);
    if (ip) return ip;
  }

  if (!targetScope) {
    return { code, renamed: 0, error: `binding '${oldName}' not found` };
  }

  const scope = targetScope as Scope;
  const binding = scope.getBinding(oldName);
  const totalRefs = binding ? binding.references + 1 : 0;
  try {
    scope.rename(oldName, newName);
  } catch (e) {
    return { code, renamed: 0, error: `rename failed: ${e instanceof Error ? e.message : e}` };
  }

  const out = generate(ast, { retainLines: true, compact: false, jsescOption: { minimal: true } }, code);
  return { code: out.code, renamed: totalRefs, scopePath: targetPath };
}

export interface BindingLocation {
  name: string;
  line: number;
  column: number;
  refCount: number;
  kind: string;
  scopePath: string;
}

function collectClassBindingLocations(ast: BabelFile): BindingLocation[] {
  const extra: BindingLocation[] = [];

  traverse(ast, {
    ClassDeclaration(p) {
      walkClass(p);
    },
    ClassExpression(p) {
      walkClass(p);
    },
  });

  return extra;

  function walkClass(classPath: NodePath<t.ClassDeclaration | t.ClassExpression>) {
    const methodNames = new Set<string>();
    classPath.get('body').traverse({
      ClassMethod(m) {
        const k = m.node.key;
        if (t.isIdentifier(k) && !m.node.computed) methodNames.add(k.name);
      },
    });

    classPath.get('body').traverse({
      ClassMethod(methodPath) {
        const k = methodPath.node.key;
        if (!t.isIdentifier(k) || methodPath.node.computed) return;
        const name = k.name;
        const loc = k.loc;
        if (!loc) return;
        let thisHits = 0;
        classPath.get('body').traverse({
          MemberExpression(mp) {
            if (mp.node.computed) return;
            const pr = mp.node.property;
            if (!t.isIdentifier(pr) || pr.name !== name) return;
            if (!t.isThisExpression(mp.node.object)) return;
            thisHits++;
          },
        });
        extra.push({
          name,
          line: loc.start.line,
          column: loc.start.column,
          refCount: 1 + thisHits,
          kind: 'method',
          scopePath: scopePathOf(methodPath.scope),
        });
      },
    });

    const propAgg = new Map<string, { count: number; line: number; column: number }>();
    classPath.get('body').traverse({
      MemberExpression(mp) {
        if (mp.node.computed) return;
        const pr = mp.node.property;
        if (!t.isIdentifier(pr)) return;
        if (!t.isThisExpression(mp.node.object)) return;
        if (methodNames.has(pr.name)) return;
        const loc = pr.loc;
        if (!loc) return;
        const cur = propAgg.get(pr.name);
        if (cur) cur.count++;
        else propAgg.set(pr.name, { count: 1, line: loc.start.line, column: loc.start.column });
      },
    });

    const csp = scopePathOf(classPath.scope);
    for (const [name, info] of propAgg) {
      extra.push({
        name,
        line: info.line,
        column: info.column,
        refCount: info.count,
        kind: 'instanceProp',
        scopePath: csp,
      });
    }
  }
}

export function listBindings(code: string): BindingLocation[] {
  let ast;
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
      errorRecovery: true,
      plugins: ['jsx', 'typescript'],
    });
  } catch {
    return [];
  }

  const out: BindingLocation[] = [];
  const seen = new Set<string>();

  traverse(ast, {
    Scope(path) {
      const bindings = path.scope.bindings;
      const sp = scopePathOf(path.scope);
      for (const name of Object.keys(bindings)) {
        const b = bindings[name];
        if (isClassDeclarationSelfBinding(path, b.path)) continue;
        const loc = b.identifier.loc;
        if (!loc) continue;
        const key = `${name}@${sp}@${loc.start.line}:${loc.start.column}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let kind: string = b.kind || 'var';
        if (b.path.isClassDeclaration?.()) kind = 'class';
        else if (b.path.isClassExpression?.()) kind = 'class';
        out.push({
          name,
          line: loc.start.line,
          column: loc.start.column,
          refCount: b.references + 1,
          kind,
          scopePath: sp,
        });
      }
    },
  });

  for (const row of collectClassBindingLocations(ast)) {
    const key = `${row.name}@${row.scopePath}@${row.line}:${row.column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  return out;
}

export interface RenameMapEntry {
  from: string;
  to: string;
  scopePath?: string;
}

export interface ReplayReport {
  code: string;
  applied: RenameMapEntry[];
  skipped: Array<{ entry: RenameMapEntry; reason: string }>;
}

export function replayRenameMap(code: string, entries: RenameMapEntry[]): ReplayReport {
  let working = code;
  const applied: RenameMapEntry[] = [];
  const skipped: Array<{ entry: RenameMapEntry; reason: string }> = [];

  for (const entry of entries) {
    const result = renameBinding(
      working,
      entry.from,
      entry.to,
      undefined,
      entry.scopePath,
    );
    if (result.error || result.renamed === 0) {
      if (entry.scopePath) {
        const fallback = renameBinding(working, entry.from, entry.to);
        if (!fallback.error && fallback.renamed > 0) {
          working = fallback.code;
          applied.push(entry);
          continue;
        }
      }
      skipped.push({ entry, reason: result.error ?? 'no matching binding' });
      continue;
    }
    working = result.code;
    applied.push(entry);
  }

  return { code: working, applied, skipped };
}

export interface BatchRenameOp {
  from: string;
  to: string;
  scopePath?: string;
  position?: { line: number; column: number };
}

export interface BatchRenameResult {
  code: string;
  applied: Array<{ from: string; to: string; scopePath: string; refs: number }>;
  skipped: Array<{ op: BatchRenameOp; reason: string }>;
}

export function batchRenameBindings(code: string, ops: BatchRenameOp[]): BatchRenameResult {
  if (ops.length === 0) return { code, applied: [], skipped: [] };

  let ast;
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
      errorRecovery: true,
      plugins: ['jsx', 'typescript'],
    });
  } catch (e) {
    return {
      code,
      applied: [],
      skipped: ops.map((op) => ({ op, reason: `parse failed: ${e instanceof Error ? e.message : e}` })),
    };
  }

  type BindingHit =
    | { kind: 'lexical'; scope: Scope; scopePath: string }
    | {
        kind: 'classMethod';
        classPath: NodePath<t.ClassDeclaration | t.ClassExpression>;
        scopePath: string;
      }
    | {
        kind: 'instanceProp';
        classPath: NodePath<t.ClassDeclaration | t.ClassExpression>;
        scopePath: string;
      };
  const byNameAndPath = new Map<string, BindingHit>();
  const byNameAndLine = new Map<string, BindingHit[]>();

  const indexInstancePropMemberExpressions = (
    classPath: NodePath<t.ClassDeclaration | t.ClassExpression>,
  ) => {
    const csp = scopePathOf(classPath.scope);
    const seen = new Set<string>();
    classPath.get('body').traverse({
      MemberExpression(mp) {
        if (mp.node.computed) return;
        if (!t.isThisExpression(mp.node.object)) return;
        const prop = mp.node.property;
        if (!t.isIdentifier(prop)) return;
        const name = prop.name;
        if (seen.has(name)) return;
        seen.add(name);
        const ent: BindingHit = { kind: 'instanceProp', classPath, scopePath: csp };
        byNameAndPath.set(`${name}@${csp}`, ent);
        const line = prop.loc?.start.line;
        if (line != null) {
          const lk = `${name}@${line}`;
          const arr = byNameAndLine.get(lk);
          if (arr) arr.push(ent);
          else byNameAndLine.set(lk, [ent]);
        }
      },
    });
  };

  traverse(ast, {
    Scope(path) {
      const sp = scopePathOf(path.scope);
      for (const name of Object.keys(path.scope.bindings)) {
        const b = path.scope.bindings[name];
        if (isClassDeclarationSelfBinding(path, b.path)) continue;
        byNameAndPath.set(`${name}@${sp}`, { kind: 'lexical', scope: path.scope, scopePath: sp });
        const line = b.identifier.loc?.start.line;
        if (line != null) {
          const key = `${name}@${line}`;
          const ent: BindingHit = { kind: 'lexical', scope: path.scope, scopePath: sp };
          const arr = byNameAndLine.get(key);
          if (arr) arr.push(ent);
          else byNameAndLine.set(key, [ent]);
        }
      }
    },
  });

  traverse(ast, {
    ClassMethod(methodPath) {
      const key = methodPath.node.key;
      if (!t.isIdentifier(key) || methodPath.node.computed) return;
      const name = key.name;
      const sp = scopePathOf(methodPath.scope);
      const classPath = classDeclOrExprParent(methodPath);
      if (!classPath) return;
      const ent: BindingHit = { kind: 'classMethod', classPath, scopePath: sp };
      byNameAndPath.set(`${name}@${sp}`, ent);
      const line = key.loc?.start.line;
      if (line != null) {
        const lk = `${name}@${line}`;
        const arr = byNameAndLine.get(lk);
        if (arr) arr.push(ent);
        else byNameAndLine.set(lk, [ent]);
      }
    },
  });

  traverse(ast, {
    ClassDeclaration(p) {
      indexInstancePropMemberExpressions(p);
    },
    ClassExpression(p) {
      indexInstancePropMemberExpressions(p);
    },
  });

  const applied: BatchRenameResult['applied'] = [];
  const skipped: BatchRenameResult['skipped'] = [];

  for (const op of ops) {
    if (!op.to.trim() || op.to === op.from) {
      skipped.push({ op, reason: 'invalid new name' });
      continue;
    }
    if (!/^[A-Za-z_$][\w$]*$/.test(op.to)) {
      skipped.push({ op, reason: 'identifier must match /^[A-Za-z_$][\\w$]*$/' });
      continue;
    }

    // Look up the binding: scopePath first, then position, then any-with-name.
    let hit: BindingHit | undefined;
    if (op.scopePath) {
      hit = byNameAndPath.get(`${op.from}@${op.scopePath}`);
    }
    if (!hit && op.position) {
      const candidates = byNameAndLine.get(`${op.from}@${op.position.line}`);
      if (candidates && candidates.length === 1) hit = candidates[0];
    }
    if (!hit) {
      // Final fallback: first scope that has a binding with this name.
      for (const [key, v] of byNameAndPath) {
        if (key.startsWith(`${op.from}@`)) { hit = v; break; }
      }
    }
    if (!hit) {
      skipped.push({ op, reason: `binding '${op.from}' not found` });
      continue;
    }

    if (hit.kind === 'classMethod') {
      const before = op.from;
      const { renamed } = renameClassInstanceMethodAst(hit.classPath, op.from, op.to);
      if (renamed === 0) {
        skipped.push({ op, reason: `binding '${op.from}' not found` });
        continue;
      }
      byNameAndPath.delete(`${before}@${hit.scopePath}`);
      byNameAndPath.set(`${op.to}@${hit.scopePath}`, {
        kind: 'classMethod',
        classPath: hit.classPath,
        scopePath: hit.scopePath,
      });
      applied.push({ from: before, to: op.to, scopePath: hit.scopePath, refs: renamed });
      continue;
    }

    if (hit.kind === 'instanceProp') {
      const before = op.from;
      const { renamed } = renameClassInstancePropertyAst(hit.classPath, op.from, op.to);
      if (renamed === 0) {
        skipped.push({ op, reason: `binding '${op.from}' not found` });
        continue;
      }
      byNameAndPath.delete(`${before}@${hit.scopePath}`);
      byNameAndPath.set(`${op.to}@${hit.scopePath}`, {
        kind: 'instanceProp',
        classPath: hit.classPath,
        scopePath: hit.scopePath,
      });
      applied.push({ from: before, to: op.to, scopePath: hit.scopePath, refs: renamed });
      continue;
    }

    // After scope.rename, bindings map uses newName; keep using saved scope ref.
    const binding = hit.scope.getBinding(op.from);
    if (!binding) {
      skipped.push({ op, reason: `binding '${op.from}' disappeared (collision with earlier rename in batch?)` });
      continue;
    }
    const refs = binding.references + 1;

    try {
      hit.scope.rename(op.from, op.to);
    } catch (e) {
      skipped.push({ op, reason: e instanceof Error ? e.message : String(e) });
      continue;
    }

    // Update our indices so a later op against the same scope still resolves.
    // The new name now lives where the old name was; we don't need to update
    // byNameAndPath because subsequent ops look up by their OWN `from`, which
    // is a different name. We only rewrite if a subsequent op targets the
    // freshly-introduced name, which is unusual but possible.
    byNameAndPath.delete(`${op.from}@${hit.scopePath}`);
    // Babel may have allocated a suffix to avoid collisions; read it back from
    // the binding map by scanning for the matching scope.
    let actualTo = op.to;
    for (const k of Object.keys(hit.scope.bindings)) {
      if (k === op.to || k.startsWith(`${op.to}_`)) {
        if (hit.scope.bindings[k] === binding) { actualTo = k; break; }
      }
    }
    byNameAndPath.set(`${actualTo}@${hit.scopePath}`, hit);
    applied.push({ from: op.from, to: actualTo, scopePath: hit.scopePath, refs });
  }

  const out = generate(ast, { retainLines: true, compact: false, jsescOption: { minimal: true } }, code);
  return { code: out.code, applied, skipped };
}
