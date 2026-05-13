import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry, ParseSummary, PipelineConfig, PipelineResult } from '../types';

interface RunState {
  running: boolean;
  step: string | null;
  percent: number;
}

/** Result of a worker rename batch. Mirrors what App.tsx needs to update state. */
export interface RenameBatchResult {
  code: string;
  applied: Array<{ from: string; to: string; scopePath: string; refs: number }>;
  skipped: Array<{ from: string; to: string; reason: string }>;
  summary: ParseSummary | null;
  log: LogEntry[];
}

export interface RenameBatchOp {
  from: string;
  to: string;
  scopePath?: string;
  position?: { line: number; column: number };
}

/**
 * The worker handles both pipeline `run` jobs and `renameBatch` jobs. We
 * track resolvers per jobId so the two kinds of in-flight work don't
 * cross-resolve each other.
 */
export function usePipeline() {
  const workerRef = useRef<Worker | null>(null);
  const jobIdRef = useRef(0);
  const pipelineResolversRef = useRef<Map<string, (r: PipelineResult) => void>>(new Map());
  const renameResolversRef = useRef<Map<string, (r: RenameBatchResult) => void>>(new Map());
  const [run, setRun] = useState<RunState>({ running: false, step: null, percent: 0 });
  const [renameBusy, setRenameBusy] = useState(false);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/pipeline.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (ev) => {
      const msg = ev.data;
      if (msg.type === 'progress') {
        setRun({ running: true, step: msg.step, percent: msg.percent });
      } else if (msg.type === 'done') {
        setRun({ running: false, step: null, percent: 100 });
        const resolve = pipelineResolversRef.current.get(msg.jobId);
        if (resolve) {
          pipelineResolversRef.current.delete(msg.jobId);
          resolve(msg.result);
        }
      } else if (msg.type === 'renameBatchDone') {
        const resolve = renameResolversRef.current.get(msg.jobId);
        if (resolve) {
          renameResolversRef.current.delete(msg.jobId);
          resolve({
            code: msg.code,
            applied: msg.applied,
            skipped: msg.skipped,
            summary: msg.summary,
            log: msg.log,
          });
        }
        if (renameResolversRef.current.size === 0) setRenameBusy(false);
      } else if (msg.type === 'error') {
        setRun({ running: false, step: null, percent: 0 });
        const pipelineResolve = pipelineResolversRef.current.get(msg.jobId);
        if (pipelineResolve) {
          pipelineResolversRef.current.delete(msg.jobId);
          pipelineResolve({ output: '', log: [{ ts: Date.now(), level: 'err', source: 'worker', message: msg.error }], summary: null });
        }
      }
    });
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const execute = useCallback((input: string, config: PipelineConfig): Promise<PipelineResult> => {
    return new Promise<PipelineResult>((resolve) => {
      if (!workerRef.current) {
        resolve({ output: input, log: [{ ts: Date.now(), level: 'err', source: 'pipeline', message: 'worker not ready' }], summary: null });
        return;
      }
      const jobId = String(++jobIdRef.current);
      pipelineResolversRef.current.set(jobId, resolve);
      setRun({ running: true, step: 'init', percent: 0 });
      workerRef.current.postMessage({ type: 'run', input, config, jobId });
    });
  }, []);

  const renameBatch = useCallback(
    (input: string, ops: RenameBatchOp[], config: PipelineConfig): Promise<RenameBatchResult> => {
      return new Promise<RenameBatchResult>((resolve) => {
        if (!workerRef.current) {
          resolve({
            code: input,
            applied: [],
            skipped: ops.map((op) => ({ from: op.from, to: op.to, reason: 'worker not ready' })),
            summary: null,
            log: [{ ts: Date.now(), level: 'err', source: 'rename', message: 'worker not ready' }],
          });
          return;
        }
        const jobId = String(++jobIdRef.current);
        renameResolversRef.current.set(jobId, resolve);
        setRenameBusy(true);
        workerRef.current.postMessage({ type: 'renameBatch', input, ops, config, jobId });
      });
    },
    [],
  );

  return { run, renameBusy, execute, renameBatch };
}
