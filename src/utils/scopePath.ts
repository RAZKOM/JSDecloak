import type { NodePath, Scope } from '@babel/traverse';
import type * as t from '@babel/types';

/** Scope path from Program to `scope` (node types + discriminators). Stable across format/deobfuscate; changes if an enclosing function is renamed. */
export function scopePathOf(scope: Scope): string {
  const segments: string[] = [];
  let cur: Scope | null = scope;
  while (cur) {
    segments.unshift(segmentFor(cur.path as NodePath));
    cur = cur.parent;
  }
  return segments.join('>');
}

function segmentFor(path: NodePath): string {
  const node = path.node;
  if (!node) return 'Unknown';
  const type = node.type;

  // Functions and classes: append name when present for human-readable paths
  // and to discriminate sibling declarations.
  if (
    type === 'FunctionDeclaration' ||
    type === 'FunctionExpression' ||
    type === 'ClassDeclaration' ||
    type === 'ClassExpression'
  ) {
    const named = node as t.FunctionDeclaration | t.FunctionExpression | t.ClassDeclaration | t.ClassExpression;
    const name = named.id?.name;
    if (name) return `${type}[${name}]`;
    // Anonymous: use parent key as a positional discriminator
    const key = path.parentKey;
    if (typeof key === 'string') return `${type}<${key}>`;
    return type;
  }

  if (type === 'ArrowFunctionExpression') {
    // Arrows are anonymous; use parent key for positional stability.
    const key = path.parentKey;
    if (typeof key === 'string') return `Arrow<${key}>`;
    return 'Arrow';
  }

  if (type === 'CatchClause') return 'Catch';

  // For block-y scopes, the bare type is fine. Babel scopes only attach to
  // scope-creating nodes, so we won't see arbitrary statements here.
  return type;
}
