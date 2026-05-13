import { useState } from 'react';
import type { PipelineConfig, PipelineStep, DeobEngine } from '../types';

interface Props {
  config: PipelineConfig;
  onChange: (c: PipelineConfig) => void;
  onClose: () => void;
}

const ENGINE_INFO: Record<DeobEngine, { label: string; tag: string; desc: string }> = {
  wakaru: {
    label: 'Wakaru',
    tag: 'AGGRESSIVE',
    desc: 'AST-level deobfuscation with code restoration. Broad rule set; often the most invasive choice here. If Wakaru throws in the worker, the pipeline falls back to Webcrack (see pipeline log).',
  },
  synchrony: {
    label: 'Synchrony',
    tag: 'OBFUSCATOR.IO',
    desc: 'Targets obfuscator.io-style patterns. Usually gentler than Wakaru or Webcrack, but can still rename identifiers and reshape code.',
  },
  webcrack: {
    label: 'Webcrack',
    tag: 'UNPACK',
    desc: 'Unpacks bundles (webpack, browserify) and runs its own deobfuscation passes; output can diverge a lot from the pasted file when unpacking or rewriting modules. May run extracted decoder JS in the worker (see warning below).',
  },
  none: {
    label: 'None / manual',
    tag: 'SKIP',
    desc: 'Skip automated deobfuscation. Goes directly to parse and rename workspace.',
  },
};

export function PipelinePanel({ config, onChange, onClose }: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const deobfuscateOn = config.steps.some((s) => s.id === 'deobfuscate' && s.enabled);

  function toggleStep(id: string) {
    onChange({
      ...config,
      steps: config.steps.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    });
  }

  function onDragStart(id: string) {
    setDraggingId(id);
  }
  function onDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    setOverId(id);
  }
  function onDrop(id: string) {
    if (!draggingId || draggingId === id) {
      setDraggingId(null);
      setOverId(null);
      return;
    }
    const steps = [...config.steps];
    const from = steps.findIndex((s) => s.id === draggingId);
    const to = steps.findIndex((s) => s.id === id);
    const [moved] = steps.splice(from, 1);
    steps.splice(to, 0, moved);
    onChange({ ...config, steps });
    setDraggingId(null);
    setOverId(null);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="panel w-[680px] max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <span>›_ pipeline configuration</span>
          <button onClick={onClose} className="btn-ghost btn py-0! px-2! text-[10px]!">
            close [esc]
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-6">
          <section>
            <div className="text-[10px] tracking-[0.14em] uppercase txt-bone-3 mb-2">
              [1] Processing steps · drag to reorder
            </div>
            <div className="space-y-1.5">
              {config.steps.map((step: PipelineStep, idx) => (
                <div
                  key={step.id}
                  draggable
                  onDragStart={() => onDragStart(step.id)}
                  onDragOver={(e) => onDragOver(e, step.id)}
                  onDrop={() => onDrop(step.id)}
                  className={`step-card ${draggingId === step.id ? 'dragging' : ''} ${overId === step.id ? 'over' : ''} ${!step.enabled ? 'disabled' : ''}`}
                >
                  <div className="text-[10px] txt-bone-4 w-6">{String(idx + 1).padStart(2, '0')}</div>
                  <input
                    type="checkbox"
                    className="check"
                    checked={step.enabled}
                    onChange={() => toggleStep(step.id)}
                  />
                  <div className="flex-1">
                    <div className="text-[12px] txt-amber tracking-wide">{step.label}</div>
                    <div className="text-[11px] txt-bone-3">{step.description}</div>
                  </div>
                  <div className="text-[18px] txt-bone-4 leading-none select-none">⋮⋮</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="text-[10px] tracking-[0.14em] uppercase txt-bone-3 mb-2">
              [2] Deobfuscation engine
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(ENGINE_INFO) as DeobEngine[]).map((e) => {
                const info = ENGINE_INFO[e];
                const active = config.engine === e;
                return (
                  <button
                    key={e}
                    onClick={() => onChange({ ...config, engine: e })}
                    className={`text-left p-3 border transition ${active ? 'border-amber bg-ink-2' : 'border-line bg-ink-2 hover:border-line-bright'}`}
                    style={{
                      borderColor: active ? 'var(--color-amber)' : 'var(--color-line)',
                      background: active ? 'var(--color-ink-3)' : 'var(--color-ink-2)',
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={active ? 'txt-amber' : ''} style={{ fontWeight: 500 }}>
                        {info.label}
                      </span>
                      <span className="chip">{info.tag}</span>
                    </div>
                    <div className="text-[10.5px] txt-bone-3 leading-snug">{info.desc}</div>
                  </button>
                );
              })}
            </div>
            {deobfuscateOn && config.engine === 'wakaru' && (
              <div
                className="mt-2 p-3 border text-[11px]"
                style={{ borderColor: 'var(--color-line)', background: 'var(--color-ink-2)' }}
              >
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="check mt-0.5 shrink-0"
                    checked={config.wakaruAggressive}
                    onChange={(e) => onChange({ ...config, wakaruAggressive: e.target.checked })}
                  />
                  <span>
                    <span className="txt-bone-1 font-medium">Wakaru aggressive mode</span>
                    <span className="txt-bone-3 block mt-0.5 leading-snug">
                      Applies extra invasive AST transforms; output may diverge more from the paste.
                    </span>
                  </span>
                </label>
              </div>
            )}
            {deobfuscateOn && config.engine !== 'none' && (
              <div className="mt-2 p-3 border" style={{ borderColor: 'var(--color-amber-dim)', background: 'rgba(255, 158, 61, 0.04)' }}>
                <div className="flex items-start gap-2">
                  <span className="txt-amber text-[12px] mt-0.5">▲</span>
                  <div className="text-[11px] txt-bone-1 leading-snug">
                    <strong className="txt-amber">Code execution.</strong> When Webcrack runs (selected engine, or
                    automatic fallback if Wakaru or Synchrony throws), this app evaluates decoder snippets from your
                    paste inside a Web Worker via <code className="txt-bone-2">new Function</code>. That is not a
                    hardened sandbox: treat unknown or hostile samples as untrusted (for example, they can still use{' '}
                    <code className="txt-bone-2">fetch</code> from a worker or burn CPU). Use engine{' '}
                    <strong className="txt-amber">None</strong> or disable the deobfuscation step if you need static
                    handling only.
                  </div>
                </div>
              </div>
            )}
          </section>

          <section>
            <div className="text-[10px] tracking-[0.14em] uppercase txt-bone-3 mb-2">
              [3] Format & parse
            </div>
            <div className="grid grid-cols-2 gap-3 text-[11px]">
              <label className="flex flex-col gap-1">
                <span className="txt-bone-3">prettier print width</span>
                <input
                  type="number"
                  value={config.printWidth}
                  onChange={(e) => onChange({ ...config, printWidth: Number(e.target.value) })}
                  min={40}
                  max={200}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="txt-bone-3">indent size</span>
                <input
                  type="number"
                  value={config.indentSize}
                  onChange={(e) => onChange({ ...config, indentSize: Number(e.target.value) })}
                  min={1}
                  max={8}
                />
              </label>
              <label className="flex items-center gap-2 mt-1">
                <input
                  type="checkbox"
                  className="check"
                  checked={config.parseJsx}
                  onChange={(e) => onChange({ ...config, parseJsx: e.target.checked })}
                />
                <span>parse JSX</span>
              </label>
              <label className="flex items-center gap-2 mt-1">
                <input
                  type="checkbox"
                  className="check"
                  checked={config.parseTypescript}
                  onChange={(e) => onChange({ ...config, parseTypescript: e.target.checked })}
                />
                <span>parse TypeScript</span>
              </label>
              <label className="flex items-start gap-2 mt-1 col-span-2">
                <input
                  type="checkbox"
                  className="check mt-0.5 shrink-0"
                  checked={config.includeAstTree}
                  onChange={(e) => onChange({ ...config, includeAstTree: e.target.checked })}
                />
                <span>
                  Include slim AST tree
                  <span className="block txt-bone-4 mt-0.5 leading-snug">
                    When the parse step runs, build a bounded structure-only AST for the parse drawer Tree tab (extra worker work and message size).
                    Disable on very large snippets if parsing feels sluggish.
                  </span>
                </span>
              </label>
            </div>
          </section>
        </div>

        <div className="panel-header border-b-0! border-t" style={{ borderColor: 'var(--color-line)' }}>
          <span className="txt-bone-4">
            <kbd>esc</kbd> close · <kbd>⌘ enter</kbd> run pipeline
          </span>
          <button onClick={onClose} className="btn btn-primary">apply</button>
        </div>
      </div>
    </div>
  );
}
