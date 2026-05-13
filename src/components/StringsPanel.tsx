import { useMemo, useState } from 'react';
import type { OutputRevealRequest, StringLiteralEntry } from '../types';
import { possibleDecodings, tryBase64, tryHex, tryUrlDecode, type DecodeAttempt } from '../utils/decoders';

interface Props {
  strings: StringLiteralEntry[];
  parseSourceLength: number;
  onClose: () => void;
  onReveal: (req: OutputRevealRequest) => void;
}

type DecoderKind = 'base64' | 'hex' | 'url';

function entryReveal(s: StringLiteralEntry, parseSourceLength: number): OutputRevealRequest {
  return {
    parseSourceLength,
    rangeStartLineNumber: s.rangeStartLineNumber,
    rangeStartColumn: s.rangeStartColumn,
    rangeEndLineNumber: s.rangeEndLineNumber,
    rangeEndColumn: s.rangeEndColumn,
    startOffset: s.startOffset,
    endOffset: s.endOffset,
  };
}

function runDecoder(kind: DecoderKind, value: string): DecodeAttempt {
  switch (kind) {
    case 'base64': return tryBase64(value);
    case 'hex': return tryHex(value);
    case 'url': return tryUrlDecode(value);
  }
}

function previewText(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function escaped(value: string, max = 160): string {
  const out: string[] = [];
  for (const ch of value.slice(0, max)) {
    const code = ch.charCodeAt(0);
    if (ch === '\n') out.push('\\n');
    else if (ch === '\r') out.push('\\r');
    else if (ch === '\t') out.push('\\t');
    else if (code < 0x20 || code === 0x7f) out.push(`\\x${code.toString(16).padStart(2, '0')}`);
    else out.push(ch);
  }
  if (value.length > max) out.push('…');
  return out.join('');
}

export function StringsPanel({ strings, parseSourceLength, onClose, onReveal }: Props) {
  const [filter, setFilter] = useState('');
  const [minLen, setMinLen] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(strings.length > 0 ? 0 : null);
  const [decodeKind, setDecodeKind] = useState<DecoderKind | null>(null);

  const filtered = useMemo(() => {
    const f = filter.toLowerCase();
    return strings.filter((s) =>
      s.length >= minLen && (!f || s.value.toLowerCase().includes(f)),
    );
  }, [strings, filter, minLen]);

  const selected = selectedIdx != null ? filtered[selectedIdx] : null;
  const decodings = selected ? possibleDecodings(selected.value) : { base64: false, hex: false, url: false };

  const decoded = useMemo<DecodeAttempt | null>(() => {
    if (!selected || !decodeKind) return null;
    return runDecoder(decodeKind, selected.value);
  }, [selected, decodeKind]);

  function pickEntry(idx: number) {
    setSelectedIdx(idx);
    setDecodeKind(null);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="panel w-[860px] max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <span>›_ string literals · {strings.length} surfaced</span>
          <button onClick={onClose} className="btn-ghost btn py-0! px-2! text-[10px]!">close [esc]</button>
        </div>

        <div className="px-4 py-2 border-b flex items-center gap-3 text-[11px]" style={{ borderColor: 'var(--color-line)' }}>
          <input
            type="text"
            placeholder="filter (substring)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="py-1! flex-1"
          />
          <label className="flex items-center gap-2 txt-bone-3">
            min length
            <input
              type="number"
              value={minLen}
              onChange={(e) => setMinLen(Math.max(0, Number(e.target.value) || 0))}
              min={0}
              max={10_000}
              className="py-1! w-20"
            />
          </label>
          <span className="txt-bone-4">{filtered.length} shown</span>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-2">
          <div className="overflow-y-auto border-r" style={{ borderColor: 'var(--color-line)' }}>
            {filtered.length === 0 ? (
              <div className="p-6 txt-bone-4 text-[11px] italic">// no strings match</div>
            ) : (
              filtered.map((s, i) => (
                <button
                  key={`${s.index}-${i}`}
                  onClick={() => pickEntry(i)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition hover:bg-ink-2"
                  style={{
                    background: selectedIdx === i ? 'var(--color-ink-3)' : undefined,
                    borderBottom: '1px solid var(--color-line)',
                  }}
                >
                  <span className="text-[10px] txt-bone-4 w-12 shrink-0">{s.length}b</span>
                  <span className="text-[11px] truncate font-mono">{escaped(s.value, 80)}</span>
                </button>
              ))
            )}
          </div>

          <div className="overflow-y-auto p-4">
            {!selected ? (
              <div className="txt-bone-4 text-[11px] italic">// select a string on the left</div>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] txt-bone-3 mb-1">raw · {selected.length} bytes</div>
                  <pre
                    className="text-[11px] whitespace-pre-wrap break-all p-2 border max-h-[180px] overflow-y-auto"
                    style={{ borderColor: 'var(--color-line)', background: 'var(--color-ink-2)' }}
                  >
                    {previewText(selected.value, 4_000)}
                  </pre>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-[0.14em] txt-bone-3">decode as</span>
                  {(['base64', 'hex', 'url'] as DecoderKind[]).map((kind) => {
                    const enabled = decodings[kind];
                    const active = decodeKind === kind;
                    return (
                      <button
                        key={kind}
                        disabled={!enabled}
                        onClick={() => setDecodeKind(active ? null : kind)}
                        className={`btn py-0.5! text-[10px]! ${active ? 'btn-primary' : ''}`}
                        style={{ opacity: enabled ? 1 : 0.4 }}
                        title={enabled ? '' : 'does not match this encoding'}
                      >
                        {kind}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => onReveal(entryReveal(selected, parseSourceLength))}
                    className="btn py-0.5! text-[10px]! ml-auto"
                  >
                    reveal in output
                  </button>
                </div>

                {decodeKind && decoded && (
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] txt-bone-3 mb-1">
                      decoded · {decodeKind}
                      {decoded.ok && decoded.value != null && <span className="txt-bone-4"> · {decoded.value.length} bytes</span>}
                    </div>
                    {decoded.ok ? (
                      <pre
                        className="text-[11px] whitespace-pre-wrap break-all p-2 border max-h-[260px] overflow-y-auto"
                        style={{ borderColor: 'var(--color-matrix)', background: 'var(--color-ink-2)' }}
                      >
                        {previewText(decoded.value ?? '', 4_000)}
                      </pre>
                    ) : (
                      <div className="text-[11px] txt-rust">decode failed: {decoded.error}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="panel-header border-b-0! border-t" style={{ borderColor: 'var(--color-line)' }}>
          <span className="txt-bone-4 text-[10px]">
            short / structural strings (import sources, object keys) are filtered out
          </span>
          <button onClick={onClose} className="btn">close</button>
        </div>
      </div>
    </div>
  );
}
