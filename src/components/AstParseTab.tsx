import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AstSlimNode, OutputRevealRequest, OutlineNode, ParseSummary, SymbolInfo } from '../types';
import { obfuscationScore } from '../utils/obfuscation';

type AstSubTab = 'symbols' | 'outline' | 'tree';

const TREE_ROW_H = 22;
const TREE_OVERSCAN = 12;
const TREE_ROOT_PATH = 'r';

type SymbolSortKey = 'name' | 'kind' | 'refs' | 'line' | 'flag';
type OutlineSortKey = 'type' | 'line';
type SortDir = 'asc' | 'desc';

const SYMBOL_KIND_HELP: Record<SymbolInfo['kind'], string> = {
  var: 'var: function-scoped or script-global binding; declaration is hoisted, initializer is not.',
  let: 'let: block-scoped lexical binding; not accessible before its declaration line (TDZ).',
  const: 'const: block-scoped binding; the binding cannot be reassigned (object/array contents may still change).',
  function: 'function: hoisted declaration binding for this function name in its scope.',
  param: 'param: formal parameter binding, local to the enclosing function.',
  class: 'class: class declaration binding (parser may emit when class syntax is present).',
  import: 'import: binding created by an import declaration.',
  method: 'method: class instance method (not a Babel scope binding; name + this.method() uses).',
  instanceProp:
    'instanceProp: only appears as this.name (e.g. constructor assignment); not a separate lexical binding.',
};

const SCOPE_HELP =
  'Internal Babel scope id (scope@… / function@…). Same human-readable name can appear many times; this disambiguates which binding instance you are looking at.';

function symbolRevealRequest(s: SymbolInfo, parseSourceLength: number): OutputRevealRequest {
  return {
    parseSourceLength,
    rangeStartLineNumber: s.rangeStartLineNumber,
    rangeStartColumn: s.rangeStartColumn,
    rangeEndLineNumber: s.rangeEndLineNumber,
    rangeEndColumn: s.rangeEndColumn,
    startOffset: s.definitionStart,
    endOffset: s.definitionEnd,
  };
}

function outlineRevealRequest(o: OutlineNode, parseSourceLength: number): OutputRevealRequest {
  return {
    parseSourceLength,
    rangeStartLineNumber: o.rangeStartLineNumber,
    rangeStartColumn: o.rangeStartColumn,
    rangeEndLineNumber: o.rangeEndLineNumber,
    rangeEndColumn: o.rangeEndColumn,
    startOffset: o.start,
    endOffset: o.end,
  };
}

function astNodeRevealRequest(n: AstSlimNode, parseSourceLength: number): OutputRevealRequest {
  return {
    parseSourceLength,
    rangeStartLineNumber: n.rangeStartLineNumber,
    rangeStartColumn: n.rangeStartColumn,
    rangeEndLineNumber: n.rangeEndLineNumber,
    rangeEndColumn: n.rangeEndColumn,
    startOffset: n.start,
    endOffset: n.end,
  };
}

function astNodeCanReveal(n: AstSlimNode, parseLength: number): boolean {
  if (parseLength < 1) return false;
  const hz =
    n.rangeStartLineNumber != null &&
    n.rangeStartColumn != null &&
    n.rangeEndLineNumber != null &&
    n.rangeEndColumn != null;
  const off = n.end > n.start;
  return hz || off;
}

type AstFlatRow = { depth: number; node: AstSlimNode; path: string };

function buildFlatAstRows(root: AstSlimNode, expanded: ReadonlySet<string>): AstFlatRow[] {
  const rows: AstFlatRow[] = [];
  function walk(node: AstSlimNode, path: string, depth: number) {
    rows.push({ node, path, depth });
    if (!expanded.has(path)) return;
    node.children.forEach((child, i) => walk(child, `${path}-${i}`, depth + 1));
  }
  walk(root, TREE_ROOT_PATH, 0);
  return rows;
}

function outlineHint(astType: string): string {
  const map: Record<string, string> = {
    FunctionDeclaration: 'Top-level (or block) named function declaration.',
    VariableDeclaration: 'One or more var / let / const declarations in a single statement.',
    ExpressionStatement: 'A bare expression executed for side effects (often a call or assignment).',
    ClassDeclaration: 'Class declaration introducing a class binding.',
    ImportDeclaration: 'Static import of another module’s exports.',
    ExportNamedDeclaration: 'Named export (possibly wrapping a declaration).',
    ExportDefaultDeclaration: 'Default export of the module.',
    EmptyStatement: 'A lone semicolon; no runtime effect.',
    BlockStatement: 'Braced block of statements.',
    IfStatement: 'Conditional branch.',
    ForStatement: 'Classic C-style for loop.',
    ForOfStatement: 'for (x of iterable) loop.',
    ForInStatement: 'for (x in object) loop.',
    WhileStatement: 'while (cond) loop.',
    DoWhileStatement: 'do … while loop.',
    ReturnStatement: 'Function return.',
    ThrowStatement: 'Throw an exception.',
    TryStatement: 'try / catch / finally.',
    BreakStatement: 'Exit the nearest enclosing loop or switch.',
    ContinueStatement: 'Next iteration of the nearest enclosing loop.',
    WithStatement: 'with (deprecated in strict mode and modules).',
    LabeledStatement: 'Statement with a label (used with break/continue).',
    DebuggerStatement: 'debugger breakpoint for devtools.',
  };
  return map[astType] ?? `Babel AST node type “${astType}”. Cross-check with the ESTree / Babel spec for exact fields.`;
}

function cmpStr(a: string, b: string, dir: SortDir): number {
  const x = a.localeCompare(b, undefined, { sensitivity: 'base' });
  return dir === 'asc' ? x : -x;
}

function cmpNum(a: number, b: number, dir: SortDir): number {
  return dir === 'asc' ? a - b : b - a;
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  tooltip,
  narrow,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  tooltip: string;
  narrow?: boolean;
}) {
  return (
    <th scope="col" className={`text-left font-normal ${narrow ? 'w-14' : ''}`}>
      <button
        type="button"
        title={tooltip}
        onClick={onClick}
        className={`ast-sort-hd w-full text-left px-2 py-1 uppercase tracking-[0.12em] text-[9px] transition ${active ? 'txt-amber' : 'txt-bone-3 hover:txt-bone-1'}`}
      >
        {label}
        {active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );
}

interface Props {
  summary: ParseSummary;
  filter: string;
  onRevealInOutput: (req: OutputRevealRequest) => void;
}

export function AstParseTab({ summary, filter, onRevealInOutput }: Props) {
  const [sub, setSub] = useState<AstSubTab>('symbols');
  const [symSort, setSymSort] = useState<{ key: SymbolSortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
  const [outSort, setOutSort] = useState<{ key: OutlineSortKey; dir: SortDir }>({ key: 'line', dir: 'asc' });

  const f = filter.trim().toLowerCase();

  const filteredSymbols = useMemo(() => {
    if (!f) return summary.symbols;
    return summary.symbols.filter(
      (s) =>
        s.name.toLowerCase().includes(f) ||
        s.kind.toLowerCase().includes(f) ||
        s.scope.toLowerCase().includes(f) ||
        String(s.refCount).includes(f) ||
        (s.definitionLine != null && String(s.definitionLine).includes(f)),
    );
  }, [summary.symbols, f]);

  const sortedSymbols = useMemo(() => {
    const { key, dir } = symSort;
    const arr = [...filteredSymbols];
    arr.sort((a, b) => {
      switch (key) {
        case 'name':
          return cmpStr(a.name, b.name, dir);
        case 'kind':
          return cmpStr(a.kind, b.kind, dir) || cmpStr(a.name, b.name, 'asc');
        case 'refs':
          return cmpNum(a.refCount, b.refCount, dir) || cmpStr(a.name, b.name, 'asc');
        case 'flag':
          return cmpNum(Number(a.isObfuscated), Number(b.isObfuscated), dir) || cmpStr(a.name, b.name, 'asc');
        case 'line': {
          const la = a.definitionLine;
          const lb = b.definitionLine;
          if (la == null && lb == null) return cmpStr(a.name, b.name, 'asc');
          if (la == null) return 1;
          if (lb == null) return -1;
          const c = cmpNum(la, lb, dir);
          return c !== 0 ? c : cmpStr(a.name, b.name, 'asc');
        }
        default:
          return 0;
      }
    });
    return arr;
  }, [filteredSymbols, symSort]);

  const outline = summary.outline ?? [];

  const filteredOutline = useMemo(() => {
    if (!f) return outline;
    return outline.filter((o) => o.astType.toLowerCase().includes(f) || String(o.line).includes(f));
  }, [outline, f]);

  const sortedOutline = useMemo(() => {
    const { key, dir } = outSort;
    const arr = [...filteredOutline];
    arr.sort((a, b) => {
      if (key === 'line') return cmpNum(a.line, b.line, dir) || cmpStr(a.astType, b.astType, 'asc');
      return cmpStr(a.astType, b.astType, dir) || cmpNum(a.line, b.line, 'asc');
    });
    return arr;
  }, [filteredOutline, outSort]);

  const toggleSymSort = useCallback((key: SymbolSortKey) => {
    setSymSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }, []);

  const toggleOutSort = useCallback((key: OutlineSortKey) => {
    setOutSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }, []);

  const onRowReveal = (req: OutputRevealRequest) => {
    if (req.parseSourceLength >= 1) onRevealInOutput(req);
  };

  const parseSourceLength = summary.parseSourceLength ?? 0;
  const treeCountLabel = summary.astTreeNodeCount != null ? String(summary.astTreeNodeCount) : '-';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="grid shrink-0 grid-cols-4 gap-3 mb-4 text-[11px]">
        <Stat label="bindings" value={summary.variableCount} title="Distinct declaration keys collected during traverse (params, vars, functions)." />
        <Stat label="strings" value={summary.stringLiteralCount} title="Count of StringLiteral nodes (each string token in source)." />
        <Stat label="functions" value={summary.functionCount} title="Function nodes (declarations, expressions, arrows) seen during traverse." />
        <Stat label="suspicious" value={summary.obfuscatedCount} accent="amber" title="Bindings whose names match heuristics for minifier-generated identifiers (see name tooltips)." />
      </div>

      <div className="flex shrink-0 items-center gap-2 mb-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.14em] txt-bone-3">// parse view</span>
        <div className="flex border" style={{ borderColor: 'var(--color-line)' }}>
          <button
            type="button"
            className={`px-2 py-0.5 text-[10px] uppercase tracking-widest ${sub === 'symbols' ? 'txt-amber' : 'txt-bone-4'}`}
            style={{ background: sub === 'symbols' ? 'var(--color-ink-2)' : 'transparent' }}
            onClick={() => setSub('symbols')}
            title="Declarations and parameters from the parse, with binding-local reference counts (Babel references, excluding the declaring identifier)."
          >
            symbols ({summary.symbols.length})
          </button>
          <button
            type="button"
            className={`px-2 py-0.5 text-[10px] uppercase tracking-widest ${sub === 'outline' ? 'txt-amber' : 'txt-bone-4'}`}
            style={{ background: sub === 'outline' ? 'var(--color-ink-2)' : 'transparent' }}
            onClick={() => setSub('outline')}
            title="Top-level statements from program.body (lightweight file structure)."
          >
            outline ({outline.length})
          </button>
          <button
            type="button"
            className={`px-2 py-0.5 text-[10px] uppercase tracking-widest ${sub === 'tree' ? 'txt-amber' : 'txt-bone-4'}`}
            style={{ background: sub === 'tree' ? 'var(--color-ink-2)' : 'transparent' }}
            onClick={() => setSub('tree')}
            title="Full slim AST after Babel parse (type + span); enable “Include slim AST tree” in pipeline options and re-run."
          >
            tree ({treeCountLabel})
          </button>
        </div>
        <span className="text-[10px] txt-bone-4">
          {sub === 'symbols'
            ? 'click a row to reveal in output · double-click name to copy'
            : sub === 'outline'
              ? 'click a row to reveal span in output'
              : '▸ expands children · click node type span to reveal in output'}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {sub === 'symbols' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto border" style={{ borderColor: 'var(--color-line)' }}>
          <table className="w-full text-[11px] border-collapse">
            <thead className="sticky top-0 z-1" style={{ background: 'var(--color-ink-1)' }}>
              <tr className="border-b" style={{ borderColor: 'var(--color-line)' }}>
                <SortHeader
                  label="name"
                  active={symSort.key === 'name'}
                  dir={symSort.dir}
                  onClick={() => toggleSymSort('name')}
                  tooltip="Identifier text. Sort alphabetically."
                />
                <SortHeader
                  label="kind"
                  active={symSort.key === 'kind'}
                  dir={symSort.dir}
                  onClick={() => toggleSymSort('kind')}
                  tooltip="Declaration role (var/let/const/function/param)."
                />
                <SortHeader
                  label="refs"
                  narrow
                  active={symSort.key === 'refs'}
                  dir={symSort.dir}
                  onClick={() => toggleSymSort('refs')}
                  tooltip="Approximate count: every Identifier visit whose text equals this symbol’s name (not binding-aware; treat as a rough signal)."
                />
                <SortHeader
                  label="line"
                  narrow
                  active={symSort.key === 'line'}
                  dir={symSort.dir}
                  onClick={() => toggleSymSort('line')}
                  tooltip="Start line of the declaration in the parsed output (1-based)."
                />
                <SortHeader
                  label="flag"
                  narrow
                  active={symSort.key === 'flag'}
                  dir={symSort.dir}
                  onClick={() => toggleSymSort('flag')}
                  tooltip="Sort by suspicious-name heuristic first."
                />
                <th scope="col" className="text-left font-normal">
                  <span className="px-2 py-1 uppercase tracking-[0.12em] text-[9px] txt-bone-3" title={SCOPE_HELP}>
                    scope
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedSymbols.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 txt-bone-4 italic text-[11px]">
                    no symbols match filter
                  </td>
                </tr>
              )}
              {sortedSymbols.map((s, i) => {
                const pl = parseSourceLength;
                const hasRange =
                  s.rangeStartLineNumber != null &&
                  s.rangeStartColumn != null &&
                  s.rangeEndLineNumber != null &&
                  s.rangeEndColumn != null;
                const hasOff =
                  s.definitionStart != null && s.definitionEnd != null && s.definitionEnd > s.definitionStart;
                const canReveal = pl >= 1 && (hasRange || hasOff);
                const obfScore = obfuscationScore(s.name);
                const obfTip = s.isObfuscated
                  ? `Flagged as suspicious: name pattern score ${(obfScore * 100).toFixed(0)}%${obfScore < 0.7 ? `, boosted because this binding has ≥3 references (Babel reference count)` : ''}. Heuristic only; verify in context.`
                  : 'Not flagged by the current name/ref heuristics.';
                const kindTip = SYMBOL_KIND_HELP[s.kind] ?? s.kind;
                return (
                  <SymbolRow
                    key={`${s.scope}:${s.kind}:${s.name}:${i}`}
                    s={s}
                    canReveal={!!canReveal}
                    kindTip={kindTip}
                    obfTip={obfTip}
                    onReveal={() => canReveal && onRowReveal(symbolRevealRequest(s, pl))}
                    onCopyName={() => navigator.clipboard.writeText(s.name).catch(() => {})}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'outline' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto border" style={{ borderColor: 'var(--color-line)' }}>
          <table className="w-full text-[11px] border-collapse">
            <thead className="sticky top-0 z-1" style={{ background: 'var(--color-ink-1)' }}>
              <tr className="border-b" style={{ borderColor: 'var(--color-line)' }}>
                <SortHeader
                  label="line"
                  narrow
                  active={outSort.key === 'line'}
                  dir={outSort.dir}
                  onClick={() => toggleOutSort('line')}
                  tooltip="Start line of this statement (1-based)."
                />
                <SortHeader
                  label="AST type"
                  active={outSort.key === 'type'}
                  dir={outSort.dir}
                  onClick={() => toggleOutSort('type')}
                  tooltip="Concrete Babel node type for this program.body entry."
                />
              </tr>
            </thead>
            <tbody>
              {sortedOutline.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-3 py-4 txt-bone-4 italic text-[11px]">
                    no outline rows match filter
                  </td>
                </tr>
              )}
              {sortedOutline.map((o, i) => (
                <tr
                  key={`${o.astType}-${o.start}-${i}`}
                  className="border-b border-line hover:bg-ink-2 cursor-pointer"
                  onClick={() => {
                    const pl = parseSourceLength;
                    if (pl < 1 || o.end <= o.start) return;
                    onRowReveal(outlineRevealRequest(o, pl));
                  }}
                  title={`${outlineHint(o.astType)}\n\nClick to select this statement in the output editor.`}
                >
                  <td className="px-2 py-1 txt-bone-3 w-12 tabular-nums">{o.line}</td>
                  <td className="px-2 py-1 font-mono text-[10px] txt-matrix">{o.astType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'tree' &&
        (summary.astRoot ? (
          <AstTreePane
            key={`${parseSourceLength}-${summary.astTreeNodeCount ?? 0}`}
            astRoot={summary.astRoot}
            filter={f}
            parseSourceLength={parseSourceLength}
            onRevealInOutput={onRowReveal}
          />
        ) : (
          <div
            className="flex min-h-0 flex-1 flex-col overflow-auto border px-3 py-4 text-[11px] txt-bone-4 leading-snug"
            style={{ borderColor: 'var(--color-line)' }}
          >
            <div className="txt-bone-3 mb-1">No slim AST for this parse.</div>
            <div>Turn on <span className="txt-bone-2">Include slim AST tree</span> in pipeline options and run again (parse step enabled).</div>
            {summary.astTreeSkipReason != null ? (
              <div className="mt-3 txt-amber font-mono text-[10px] wrap-break-word">{summary.astTreeSkipReason}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

interface AstTreePaneProps {
  astRoot: AstSlimNode;
  filter: string;
  parseSourceLength: number;
  onRevealInOutput: (req: OutputRevealRequest) => void;
}

function AstTreePane({
  astRoot,
  filter,
  parseSourceLength,
  onRevealInOutput,
}: AstTreePaneProps) {
  const [expanded, setExpanded] = useState(() => new Set<string>([TREE_ROOT_PATH]));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(320);

  const baseRows = useMemo(() => buildFlatAstRows(astRoot, expanded), [astRoot, expanded]);

  const flatRows = useMemo(() => {
    if (!filter) return baseRows;
    return baseRows.filter((row) => row.node.type.toLowerCase().includes(filter));
  }, [baseRows, filter]);

  const syncScrollMetrics = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    setViewportH(el.clientHeight);
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    if (el.scrollTop > maxScroll) el.scrollTop = maxScroll;
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    syncScrollMetrics();
    const ro = new ResizeObserver(syncScrollMetrics);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncScrollMetrics, flatRows.length]);

  const togglePath = useCallback((path: string, hasChildren: boolean) => {
    if (!hasChildren) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const totalPx = flatRows.length * TREE_ROW_H;
  const startIdx =
    flatRows.length === 0 ? 0 : Math.max(0, Math.floor(scrollTop / TREE_ROW_H) - TREE_OVERSCAN);
  const rowsVisible = Math.max(1, Math.ceil(viewportH / TREE_ROW_H));
  const endIdx =
    flatRows.length === 0
      ? 0
      : Math.min(flatRows.length, startIdx + rowsVisible + 2 * TREE_OVERSCAN + 4);

  const pl = parseSourceLength;

  return (
    <div
      ref={scrollRef}
      className="relative flex min-h-0 flex-1 flex-col overflow-auto border outline-none"
      style={{ borderColor: 'var(--color-line)' }}
      onScroll={syncScrollMetrics}
      tabIndex={0}
      role="tree"
      aria-label="Slim AST"
    >
      <div className="relative" style={{ minHeight: totalPx || TREE_ROW_H }}>
        {flatRows.length === 0 ? (
          <div className="px-3 py-4 text-[11px] txt-bone-4 italic">no tree rows match filter</div>
        ) : (
          flatRows.slice(startIdx, endIdx).map((row, vi) => {
            const globalIdx = startIdx + vi;
            const top = globalIdx * TREE_ROW_H;
            const hasKids = row.node.children.length > 0;
            const isOpen = expanded.has(row.path);
            const canReveal = astNodeCanReveal(row.node, pl);

            return (
              <div
                key={row.path}
                className="absolute left-0 right-0 flex items-stretch text-[11px] border-b border-line"
                style={{
                  top,
                  height: TREE_ROW_H,
                  paddingLeft: 4 + row.depth * 14,
                  background: globalIdx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                }}
              >
                <button
                  type="button"
                  aria-expanded={hasKids ? isOpen : undefined}
                  className={`w-6 shrink-0 flex items-center justify-center select-none txt-bone-3 hover:txt-bone-1 ${hasKids ? 'cursor-pointer' : 'opacity-35 cursor-default'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePath(row.path, hasKids);
                  }}
                  title={hasKids ? (isOpen ? 'Collapse' : 'Expand') : ''}
                  disabled={!hasKids}
                >
                  <span style={{ transform: isOpen ? 'rotate(90deg)' : undefined, display: 'inline-block' }}>▸</span>
                </button>
                <button
                  type="button"
                  className={`flex-1 text-left flex items-baseline gap-2 min-w-0 pr-2 ${canReveal ? 'hover:bg-ink-2 cursor-pointer' : 'cursor-default opacity-90'}`}
                  onClick={() => {
                    if (!canReveal) return;
                    onRevealInOutput(astNodeRevealRequest(row.node, pl));
                  }}
                  title={
                    canReveal
                      ? 'Reveal this node’s span in the output editor (stale if output was edited).'
                      : 'No usable span (offsets/loc missing for this node).'
                  }
                >
                  <span className="font-mono text-[10px] txt-matrix truncate">{row.node.type}</span>
                  <span className="txt-bone-4 tabular-nums shrink-0 text-[10px]">
                    {row.node.start}:{row.node.end}
                  </span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function SymbolRow({
  s,
  canReveal,
  kindTip,
  obfTip,
  onReveal,
  onCopyName,
}: {
  s: SymbolInfo;
  canReveal: boolean;
  kindTip: string;
  obfTip: string;
  onReveal: () => void;
  onCopyName: () => void;
}) {
  const line = s.definitionLine != null ? String(s.definitionLine) : '-';
  return (
    <tr
      className={`border-b border-line ${canReveal ? 'hover:bg-ink-2 cursor-pointer' : 'opacity-90'}`}
      onClick={() => canReveal && onReveal()}
      title={
        canReveal
          ? `${obfTip}\n\nClick row to reveal declaration in output. Double-click name to copy.`
          : `${obfTip}\n\nNo source span on this row (recovery parse or synthetic node).`
      }
    >
      <td className="px-2 py-0.5">
        <span
          className={`${s.isObfuscated ? 'txt-amber' : 'txt-bone-1'}`}
          title={obfTip}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onCopyName();
          }}
        >
          {s.name}
        </span>
      </td>
      <td className="px-2 py-0.5 text-[10px] txt-bone-4" title={kindTip}>
        {s.kind}
      </td>
      <td className="px-2 py-0.5 text-right txt-bone-3 tabular-nums w-14" title="Approximate identifier hit count (see column header).">
        {s.refCount}
      </td>
      <td
        className="px-2 py-0.5 txt-bone-3 tabular-nums w-12"
        title={s.definitionLine != null ? `Declaration starts on line ${s.definitionLine} in the parsed output.` : 'No line information (parser did not attach loc).'}
      >
        {line}
      </td>
      <td className="px-2 py-0.5 w-10 text-center" title={obfTip}>
        {s.isObfuscated ? '⚠' : '·'}
      </td>
      <td className="px-2 py-0.5 text-[10px] txt-bone-4 truncate max-w-[140px]" title={`${SCOPE_HELP}\n\n${s.scope}`}>
        {s.scope}
      </td>
    </tr>
  );
}

function Stat({ label, value, accent, title }: { label: string; value: number; accent?: 'amber'; title?: string }) {
  return (
    <div className="border p-2" style={{ borderColor: 'var(--color-line)', background: 'var(--color-ink-1)' }} title={title}>
      <div className="text-[9px] uppercase tracking-[0.14em] txt-bone-3">{label}</div>
      <div className={`text-[20px] ${accent === 'amber' ? 'txt-amber' : 'txt-bone-1'}`} style={{ fontFamily: 'var(--font-display)' }}>
        {value}
      </div>
    </div>
  );
}
