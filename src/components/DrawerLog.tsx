import { useMemo, useState } from 'react';
import type { LogEntry, OutputRevealRequest, ParseSummary, RenameOp } from '../types';
import { AstParseTab } from './AstParseTab';

interface Props {
  open: boolean;
  log: LogEntry[];
  summary: ParseSummary | null;
  renames: RenameOp[];
  onToggle: () => void;
  onClear: () => void;
  onRevealInOutput: (req: OutputRevealRequest) => void;
}

type Tab = 'log' | 'ast' | 'renames';

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export function DrawerLog({ open, log, summary, renames, onToggle, onClear, onRevealInOutput }: Props) {
  const [tab, setTab] = useState<Tab>('log');
  const [filter, setFilter] = useState('');

  const filteredLog = useMemo(() => {
    if (!filter) return log;
    const f = filter.toLowerCase();
    return log.filter((l) => l.message.toLowerCase().includes(f) || l.source.toLowerCase().includes(f));
  }, [log, filter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-t border-b" style={{ borderColor: 'var(--color-line)', background: 'var(--color-ink-1)' }}>
        <div className="flex items-center">
          <button
            onClick={onToggle}
            className="px-3 py-1.5 text-[10px] tracking-[0.14em] uppercase txt-bone-3 hover:txt-amber transition"
          >
            {open ? '▾' : '▴'} drawer
          </button>
          {open && (
            <>
              <div className="w-px h-4 mx-1" style={{ background: 'var(--color-line)' }} />
              <button onClick={() => setTab('log')} className={`tab ${tab === 'log' ? 'active' : ''}`}>
                log <span className="txt-bone-4 ml-1">{log.length}</span>
              </button>
              <button onClick={() => setTab('ast')} className={`tab ${tab === 'ast' ? 'active' : ''}`}>
                ast <span className="txt-bone-4 ml-1">{summary?.ok ? '✓' : '-'}</span>
              </button>
              <button onClick={() => setTab('renames')} className={`tab ${tab === 'renames' ? 'active' : ''}`}>
                renames <span className="txt-bone-4 ml-1">{renames.length}</span>
              </button>
            </>
          )}
        </div>
        {open && (
          <div className="flex items-center gap-2 pr-2">
            <input
              type="text"
              placeholder={tab === 'log' ? 'filter log' : tab === 'ast' ? 'filter symbols / outline' : 'filter'}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="py-0.5! text-[11px]! w-48"
            />
            <button onClick={onClear} className="btn btn-ghost py-0.5!">clear</button>
          </div>
        )}
      </div>

      {open && (
        <div
          className={`flex min-h-0 flex-1 flex-col drawer-anim ${tab === 'ast' ? 'overflow-hidden' : 'overflow-y-auto'}`}
          style={{ background: 'var(--color-ink-0)' }}
        >
          {tab === 'log' && (
            <div className="py-1">
              {filteredLog.length === 0 && (
                <div className="px-4 py-6 txt-bone-4 text-[11px] italic">// no log entries</div>
              )}
              {filteredLog.map((entry, i) => (
                <div key={i} className={`log-row ${entry.level}`}>
                  <span className="txt-bone-4">{formatTime(entry.ts)}</span>
                  <span className="txt-bone-3">{entry.source}</span>
                  <span className="txt-bone-1">{entry.message}</span>
                </div>
              ))}
            </div>
          )}
          {tab === 'ast' && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
              {!summary && (
                <div className="shrink-0 txt-bone-4 italic">// run pipeline with [parse] step enabled to populate the AST</div>
              )}
              {summary && !summary.ok && (
                <div className="shrink-0 txt-rust">parse error: {summary.error}</div>
              )}
              {summary && summary.ok && (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <AstParseTab summary={summary} filter={filter} onRevealInOutput={onRevealInOutput} />
                </div>
              )}
            </div>
          )}
          {tab === 'renames' && (
            <div className="py-1">
              {renames.length === 0 && (
                <div className="px-4 py-6 txt-bone-4 text-[11px] italic">// no renames yet · F2 on an identifier or use rename queue</div>
              )}
              {renames.map((r, i) => (
                <div key={i} className="log-row info">
                  <span className="txt-bone-4">{formatTime(r.ts)}</span>
                  <span className="txt-amber">{r.from}</span>
                  <span className="txt-bone-1">→ <span className="txt-matrix">{r.to}</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
