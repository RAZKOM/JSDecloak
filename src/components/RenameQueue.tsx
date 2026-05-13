import { useEffect, useMemo, useState } from 'react';
import { listBindings } from '../utils/rename';
import { obfuscationScore } from '../utils/obfuscation';

interface PendingOp {
  from: string;
  to: string;
  scopePath?: string;
  position?: { line: number; column: number };
}

interface Props {
  code: string;
  /** Hand off the pending ops; App routes them through the worker. */
  onApply: (ops: PendingOp[]) => void | Promise<void>;
  onClose: () => void;
  /** True while a previous batch is still in flight; disables Apply button. */
  busy?: boolean;
}

interface QueueItem {
  oldName: string;
  newName: string;
  line: number;
  column: number;
  refCount: number;
  kind: string;
  scopePath: string;
  score: number;
  applied: boolean;
  skipped: boolean;
}

/**
 * Placeholder names for batch rename. Each category gets its own counter (arg1, arg2, …)
 * so apply-all does not collide on repeated generic tokens like `arg`.
 *
 * Babel scope uses kinds such as `hoisted` for function declarations; we fold those into `function`.
 */
function assignSuggestedNewNames(items: QueueItem[], declaredNames: Iterable<string>): void {
  const taken = new Set(declaredNames);
  const nextIndex = new Map<string, number>();

  function prefixForKind(kind: string): string {
    switch (kind) {
      case 'function':
      case 'hoisted':
        return 'function';
      case 'param':
        return 'arg';
      case 'const':
        return 'const';
      case 'let':
        return 'let';
      case 'var':
        return 'var';
      case 'class':
        return 'class';
      case 'method':
        return 'method';
      case 'instanceProp':
        return 'field';
      case 'import':
      case 'module':
        return 'import';
      default:
        return 'unknownVar';
    }
  }

  function allocate(prefix: string): string {
    let i = nextIndex.get(prefix) ?? 0;
    let candidate: string;
    do {
      i++;
      candidate = `${prefix}${i}`;
    } while (taken.has(candidate));
    nextIndex.set(prefix, i);
    taken.add(candidate);
    return candidate;
  }

  for (const item of items) {
    item.newName = allocate(prefixForKind(item.kind));
  }
}

export function RenameQueue({ code, onApply, onClose, busy }: Props) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const bindings = listBindings(code);
    const next: QueueItem[] = [];
    const seen = new Set<string>();
    for (const b of bindings) {
      const score = obfuscationScore(b.name);
      if (score < 0.7 && !(score >= 0.2 && b.refCount >= 3)) continue;
      const key = `${b.name}@${b.scopePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      next.push({
        oldName: b.name,
        newName: '',
        line: b.line,
        column: b.column,
        refCount: b.refCount,
        kind: b.kind,
        scopePath: b.scopePath,
        score,
        applied: false,
        skipped: false,
      });
    }
    next.sort((a, b) => b.refCount - a.refCount);
    assignSuggestedNewNames(next, bindings.map((b) => b.name));
    setItems(next);
    setCursor(0);
  }, [code]);

  const pending = useMemo(() => items.filter(i => !i.applied && !i.skipped), [items]);

  function updateAt(i: number, patch: Partial<QueueItem>) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  }

  function skip() {
    updateAt(cursor, { skipped: true });
    setCursor(c => Math.min(c + 1, items.length - 1));
  }

  function applyOne() {
    const it = items[cursor];
    if (!it || !it.newName.trim()) return;
    updateAt(cursor, { applied: true });
    setCursor(c => Math.min(c + 1, items.length - 1));
  }

  function applyAll() {
    const pendingOps: PendingOp[] = [];
    for (const it of items) {
      if (it.applied || it.skipped) continue;
      if (!it.newName.trim()) continue;
      pendingOps.push({
        from: it.oldName,
        to: it.newName,
        scopePath: it.scopePath,
        position: { line: it.line, column: it.column },
      });
    }
    if (pendingOps.length === 0) {
      onClose();
      return;
    }
    setItems((prev) => prev.map((it) =>
      !it.applied && !it.skipped && it.newName.trim() ? { ...it, applied: true } : it,
    ));
    void onApply(pendingOps);
    onClose();
  }

  const current = items[cursor];
  const progress = items.length === 0 ? 100 : ((items.length - pending.length) / items.length) * 100;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="panel w-[720px] max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <span>›_ rename queue · {items.length} suspicious bindings</span>
          <button onClick={onClose} className="btn-ghost btn py-0! px-2! text-[10px]!">close</button>
        </div>

        <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--color-line)' }}>
          <div className="flex justify-between text-[10px] txt-bone-3 mb-1">
            <span>{items.length - pending.length} done · {pending.length} pending</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="ref-bar h-1">
            <div style={{ width: `${progress}%` }} />
          </div>
        </div>

        {items.length === 0 ? (
          <div className="p-8 text-center txt-bone-3">
            <div className="text-[14px] mb-2 txt-bone-1">No suspicious identifiers found.</div>
            <div className="text-[11px] txt-bone-4">
              The current code has no bindings matching obfuscation heuristics. Run the pipeline first if you haven't.
            </div>
          </div>
        ) : current ? (
          <div className="p-5 space-y-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] txt-bone-3 mb-2">current binding</div>
              <div className="flex items-baseline gap-3 mb-1">
                <span className="text-[22px] txt-amber" style={{ fontFamily: 'var(--font-display)' }}>
                  {current.oldName}
                </span>
                <span className="chip">{current.kind}</span>
                <span className="text-[11px] txt-bone-3">
                  {current.refCount} references · line {current.line} · score {(current.score * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-[0.14em] txt-bone-3 block mb-1">rename to</label>
              <input
                type="text"
                autoFocus
                value={current.newName}
                onChange={(e) => updateAt(cursor, { newName: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyOne();
                  if (e.key === 'Escape') onClose();
                }}
                className="w-full text-[14px]! py-2!"
                placeholder="new identifier"
              />
              <div className="text-[10px] txt-bone-4 mt-1">
                press <kbd>↵</kbd> to mark for rename · <kbd>tab</kbd> to skip · <kbd>esc</kbd> to close
              </div>
            </div>

            <div className="border-t pt-3" style={{ borderColor: 'var(--color-line)' }}>
              <div className="text-[10px] uppercase tracking-[0.14em] txt-bone-3 mb-2">
                queue · click any row to jump
              </div>
              <div className="max-h-[260px] overflow-y-auto space-y-0.5">
                {items.map((it, i) => {
                  const isCurrent = i === cursor;
                  return (
                    <button
                      key={i}
                      onClick={() => setCursor(i)}
                      className={`w-full flex items-center gap-2 px-2 py-1 text-left transition ${isCurrent ? '' : 'hover:bg-ink-2'}`}
                      style={{ background: isCurrent ? 'var(--color-ink-3)' : undefined }}
                    >
                      <span className="text-[10px] txt-bone-4 w-6">{String(i + 1).padStart(2, '0')}</span>
                      <span className={`text-[11px] flex-1 ${it.applied ? 'line-through txt-bone-4' : it.skipped ? 'txt-bone-4 italic' : ''}`}>
                        {it.oldName}
                        {it.newName && !it.applied && <span className="txt-bone-3"> → <span className="txt-matrix">{it.newName}</span></span>}
                        {it.applied && it.newName && <span className="txt-matrix"> → {it.newName}</span>}
                      </span>
                      <span className="text-[10px] txt-bone-4">{it.refCount}r</span>
                      {it.applied && <span className="text-[10px] txt-matrix">✓</span>}
                      {it.skipped && <span className="text-[10px] txt-bone-4">skip</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        <div className="panel-header border-t border-b-0!" style={{ borderColor: 'var(--color-line)' }}>
          <div className="flex items-center gap-2">
            <button onClick={skip} disabled={!current} className="btn">skip</button>
            <button onClick={applyOne} disabled={!current || !current.newName.trim()} className="btn">mark · next</button>
          </div>
          <button
            onClick={applyAll}
            className="btn btn-primary"
            disabled={busy || items.every(i => i.applied || i.skipped || !i.newName.trim())}
          >
            {busy ? '⟳ working…' : 'apply all queued ↵'}
          </button>
        </div>
      </div>
    </div>
  );
}
