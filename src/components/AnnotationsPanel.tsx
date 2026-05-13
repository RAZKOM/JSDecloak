import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Annotation, OutputRevealRequest, SymbolInfo } from '../types';
import { findAnnotation, upsertAnnotation } from '../utils/annotations';

interface Props {
  symbols: SymbolInfo[];
  annotations: Annotation[];
  parseSourceLength: number;
  onChange: (next: Annotation[]) => void;
  onClose: () => void;
  onReveal: (req: OutputRevealRequest) => void;
  prefocusBinding?: SymbolInfo | null;
  onPrefocusConsumed?: () => void;
}

function symbolReveal(s: SymbolInfo, parseSourceLength: number): OutputRevealRequest {
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

export function AnnotationsPanel({
  symbols,
  annotations,
  parseSourceLength,
  onChange,
  onClose,
  onReveal,
  prefocusBinding,
  onPrefocusConsumed,
}: Props) {
  const noteTextAreaRef = useRef<HTMLTextAreaElement>(null);
  const [noteFocusToken, setNoteFocusToken] = useState(0);

  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<SymbolInfo | null>(symbols[0] ?? null);
  const [draftKey, setDraftKey] = useState<string>(() =>
    symbols[0] ? `${symbols[0].name}@${symbols[0].scopePath}` : '',
  );
  const [noteDraft, setNoteDraft] = useState<string>(() => {
    if (!symbols[0]) return '';
    return findAnnotation(annotations, symbols[0].name, symbols[0].scopePath)?.note ?? '';
  });
  const [tagDraft, setTagDraft] = useState<string>(() => {
    if (!symbols[0]) return '';
    return findAnnotation(annotations, symbols[0].name, symbols[0].scopePath)?.tag ?? '';
  });

  const sorted = useMemo(() => {
    const annotatedKey = (s: SymbolInfo) => {
      const a = findAnnotation(annotations, s.name, s.scopePath);
      return a ? -a.ts : 1;
    };
    return [...symbols].sort((a, b) => {
      const ak = annotatedKey(a);
      const bk = annotatedKey(b);
      if (ak !== bk) return ak - bk;
      return b.refCount - a.refCount;
    });
  }, [symbols, annotations]);

  const filtered = useMemo(() => {
    const f = filter.toLowerCase();
    if (!f) return sorted;
    return sorted.filter((s) => s.name.toLowerCase().includes(f));
  }, [sorted, filter]);

  function selectSymbol(s: SymbolInfo) {
    setSelected(s);
    setDraftKey(`${s.name}@${s.scopePath}`);
    const existing = findAnnotation(annotations, s.name, s.scopePath);
    setNoteDraft(existing?.note ?? '');
    setTagDraft(existing?.tag ?? '');
  }

  useEffect(() => {
    if (!prefocusBinding) return;
    const match = symbols.find(
      (s) => s.name === prefocusBinding.name && s.scopePath === prefocusBinding.scopePath,
    );
    if (match) {
      setSelected(match);
      setDraftKey(`${match.name}@${match.scopePath}`);
      const existing = findAnnotation(annotations, match.name, match.scopePath);
      setNoteDraft(existing?.note ?? '');
      setTagDraft(existing?.tag ?? '');
      setNoteFocusToken((t) => t + 1);
      onPrefocusConsumed?.();
      return;
    }
    if (symbols.length > 0) onPrefocusConsumed?.();
  }, [prefocusBinding, symbols, annotations, onPrefocusConsumed]);

  // If the upstream symbols list changes (e.g. after a re-parse) and the
  // currently-selected binding no longer appears, expose the first available
  // row as the effective selection. We compute this each render rather than
  // syncing state-in-effect, so the picker stays sane without cascading writes.
  const effectiveSelected = useMemo<SymbolInfo | null>(() => {
    if (!selected) return symbols[0] ?? null;
    const stillThere = symbols.some(
      (s) => s.name === selected.name && s.scopePath === selected.scopePath,
    );
    return stillThere ? selected : symbols[0] ?? null;
  }, [selected, symbols]);

  useLayoutEffect(() => {
    if (!noteFocusToken) return;
    noteTextAreaRef.current?.focus();
  }, [noteFocusToken]);

  // Suppress unused warning while keeping draftKey available for diagnostics.
  void draftKey;

  function save() {
    if (!effectiveSelected) return;
    const next = upsertAnnotation(annotations, {
      name: effectiveSelected.name,
      scopePath: effectiveSelected.scopePath,
      note: noteDraft,
      tag: tagDraft.trim() || undefined,
      ts: Date.now(),
    });
    onChange(next);
  }

  function clearForSelected() {
    if (!effectiveSelected) return;
    const next = upsertAnnotation(annotations, {
      name: effectiveSelected.name,
      scopePath: effectiveSelected.scopePath,
      note: '',
      ts: Date.now(),
    });
    setNoteDraft('');
    setTagDraft('');
    onChange(next);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="panel w-[860px] max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <span>›_ annotations · {annotations.length} notes</span>
          <button onClick={onClose} className="btn-ghost btn py-0! px-2! text-[10px]!">close [esc]</button>
        </div>

        <div className="px-4 py-2 border-b flex items-center gap-3 text-[11px]" style={{ borderColor: 'var(--color-line)' }}>
          <input
            type="text"
            placeholder="filter bindings"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="py-1! flex-1"
          />
          <span className="txt-bone-4">{filtered.length} shown</span>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-[1fr_1.4fr]">
          <div className="overflow-y-auto border-r" style={{ borderColor: 'var(--color-line)' }}>
            {filtered.map((s) => {
              const ann = findAnnotation(annotations, s.name, s.scopePath);
              const isSel = effectiveSelected?.name === s.name && effectiveSelected?.scopePath === s.scopePath;
              return (
                <button
                  key={`${s.name}@${s.scopePath}`}
                  onClick={() => selectSymbol(s)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition hover:bg-ink-2"
                  style={{
                    background: isSel ? 'var(--color-ink-3)' : undefined,
                    borderBottom: '1px solid var(--color-line)',
                  }}
                >
                  <span className="text-[10px] w-3">{ann ? <span className="txt-matrix">●</span> : ''}</span>
                  <span className="text-[11px] flex-1 font-mono truncate">{s.name}</span>
                  {ann?.tag && <span className="chip">{ann.tag}</span>}
                  <span className="text-[10px] txt-bone-4">{s.kind}</span>
                  <span className="text-[10px] txt-bone-4">{s.refCount}r</span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="p-6 txt-bone-4 text-[11px] italic">// no bindings match</div>
            )}
          </div>

          <div className="overflow-y-auto p-4">
            {!effectiveSelected ? (
              <div className="txt-bone-4 text-[11px] italic">// select a binding on the left</div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-[18px] txt-amber font-mono">{effectiveSelected.name}</span>
                  <span className="chip">{effectiveSelected.kind}</span>
                  <span className="text-[10px] txt-bone-3">{effectiveSelected.refCount} refs</span>
                </div>
                <div className="text-[10px] txt-bone-4 font-mono break-all">
                  {effectiveSelected.scopePath}
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-[0.14em] txt-bone-3 block mb-1">tag</label>
                  <input
                    type="text"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    placeholder="decoder · xor key · entry · payload"
                    className="py-1! text-[12px]! w-full"
                    maxLength={32}
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-[0.14em] txt-bone-3 block mb-1">note</label>
                  <textarea
                    ref={noteTextAreaRef}
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="what this binding does, observations, todo…"
                    className="py-1! text-[12px]! w-full font-mono"
                    rows={8}
                    style={{
                      background: 'var(--color-ink-2)',
                      border: '1px solid var(--color-line)',
                      color: 'var(--color-bone-1)',
                      padding: '8px',
                      resize: 'vertical',
                    }}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={save} className="btn btn-primary">save</button>
                  <button onClick={clearForSelected} className="btn">clear</button>
                  <button
                    onClick={() => onReveal(symbolReveal(effectiveSelected, parseSourceLength))}
                    className="btn ml-auto"
                  >
                    reveal in output
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="panel-header border-b-0! border-t" style={{ borderColor: 'var(--color-line)' }}>
          <span className="txt-bone-4 text-[10px]">
            notes are keyed by binding (name + scope), survive renames, and persist with the project
          </span>
          <button onClick={onClose} className="btn">close</button>
        </div>
      </div>
    </div>
  );
}
