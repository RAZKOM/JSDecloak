import { VISITOR_KEYS } from '@babel/types';
import type { AstSlimNode } from '../types';

/** Minimal shape Babel parses into (serialized uses only visitor keys + spans). */
type BabelAstNode = {
  type: string;
  start?: number | null;
  end?: number | null;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  } | null;
};

function isAstNode(value: unknown): value is BabelAstNode {
  return Boolean(value) && typeof value === 'object' && typeof (value as BabelAstNode).type === 'string';
}

function collectChildNodes(parent: BabelAstNode): BabelAstNode[] {
  const keys = VISITOR_KEYS[parent.type as keyof typeof VISITOR_KEYS];
  if (!keys) return [];
  const kids: BabelAstNode[] = [];
  const o = parent as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (isAstNode(item)) kids.push(item);
      }
    } else if (isAstNode(v)) {
      kids.push(v);
    }
  }
  return kids;
}

/**
 * Depth-first visitor-key order counts nodes; returns false once count exceeds maxNodes.
 */
export function countSlimAstNodes(root: BabelAstNode | null | undefined, maxNodes: number): number {
  if (!root) return -1;
  let n = 0;
  const stack: BabelAstNode[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    n++;
    if (n > maxNodes) return n;
    const kids = collectChildNodes(node);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
  return n;
}

function spansFrom(node: BabelAstNode): Pick<
  AstSlimNode,
  'start' | 'end' | 'rangeStartLineNumber' | 'rangeStartColumn' | 'rangeEndLineNumber' | 'rangeEndColumn'
> {
  const start = node.start ?? 0;
  const end = node.end ?? 0;
  const loc = node.loc;
  if (loc?.start != null && loc.end != null) {
    return {
      start,
      end,
      rangeStartLineNumber: loc.start.line,
      rangeStartColumn: loc.start.column + 1,
      rangeEndLineNumber: loc.end.line,
      rangeEndColumn: loc.end.column + 1,
    };
  }
  return { start, end };
}

function buildSlimAstRecursive(node: BabelAstNode): AstSlimNode {
  const span = spansFrom(node);
  const base: AstSlimNode = {
    type: node.type,
    start: span.start,
    end: span.end,
    children: collectChildNodes(node).map(buildSlimAstRecursive),
  };
  if (span.rangeStartLineNumber != null) {
    base.rangeStartLineNumber = span.rangeStartLineNumber;
    base.rangeStartColumn = span.rangeStartColumn;
    base.rangeEndLineNumber = span.rangeEndLineNumber;
    base.rangeEndColumn = span.rangeEndColumn;
  }
  return base;
}

/**
 * Builds a slim JSON AST in the same visitor-key DFS order used by counting.
 */
export function buildSlimAst(root: BabelAstNode): AstSlimNode {
  return buildSlimAstRecursive(root);
}

export type SerializeAstSlimResult =
  | { ok: true; root: AstSlimNode; nodeCount: number }
  | { ok: false; skipReason: string; attemptedCount: number };

/**
 * Two-phaseCount then build ensures all-or-nothing when budgets are tight.
 */
export function serializeAstToSlim(root: BabelAstNode | null | undefined, maxNodes: number): SerializeAstSlimResult {
  if (!root) return { ok: false, skipReason: 'missing AST root', attemptedCount: 0 };
  const attemptedCount = countSlimAstNodes(root, maxNodes);
  if (attemptedCount > maxNodes) {
    return {
      ok: false,
      skipReason: `node budget exceeded (>${maxNodes}, counted ${attemptedCount})`,
      attemptedCount,
    };
  }
  const slimRoot = buildSlimAst(root);
  return { ok: true, root: slimRoot, nodeCount: attemptedCount };
}
