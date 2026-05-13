import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { Range } from 'monaco-editor';
import { Toolbar } from './components/Toolbar';
import { CodeEditor } from './components/CodeEditor';
import { Splitter } from './components/Splitter';
import { PipelinePanel } from './components/PipelinePanel';
import { BottomDrawer } from './components/BottomDrawer';
import { RenameQueue } from './components/RenameQueue';
import { StringsPanel } from './components/StringsPanel';
import { AnnotationsPanel } from './components/AnnotationsPanel';
import { DiffPane } from './components/DiffPane';
import { usePipeline } from './hooks/usePipeline';
import { useAutosave } from './hooks/useAutosave';
import {
  disposeOutputRenameProvider,
  registerOutputRenameProvider,
  type OutputRenameBridge,
} from './monaco/jsdecloakOutputMonaco';
import {
  disposeJsFormatProvider,
  registerJsFormatProvider,
  type FormatBridge,
} from './monaco/jsdecloakFormatProvider';
import type { Annotation, OutputRevealRequest, PipelineConfig, LogEntry, ParseSummary, ProjectFile, RenameOp, SymbolInfo } from './types';
import type { OutputBindingNotesBridgeRef } from './monaco/outputBindingNoteAction';
import { migrateAnnotationOnRename } from './utils/annotations';
import { type RenameMapEntry } from './utils/rename';
import { buildProjectFile, isProjectFile, normalizeProject } from './utils/projectFile';
import { clearSession, loadSession } from './utils/sessionStore';
import { loadAppSettings, persistAppSettings, type AppSettings } from './utils/appSettings';
import { monacoThemeIdForAppTheme } from './monaco/jsdecloakMonacoThemes';
import SAMPLE_OBFUSCATED from './defaultSampleInput.js?raw';

function resetEditorViewportToStart(ed: editor.IStandaloneCodeEditor | null) {
  if (!ed || !ed.getModel()) return;
  ed.setSelection(new Range(1, 1, 1, 1));
  ed.setScrollTop(0);
  ed.setScrollLeft(0);
  ed.revealLineNearTop(1);
}

function renameOpsEquivalent(a: RenameOp, b: RenameOp): boolean {
  return a.from === b.from && a.to === b.to && a.scopePath === b.scopePath;
}

type OutputRenameUndoFrame = {
  before: string;
  after: string;
  op: RenameOp;
  active: boolean;
};

/** Captured once at module load so the first log line has a stable timestamp without calling Date.now during render. */
const INITIAL_LOG_TS = Date.now();

const DEFAULT_CONFIG: PipelineConfig = {
  steps: [
    { id: 'format', enabled: true, label: 'Formatter / Beautifier', description: 'unminify with js-beautify · non-destructive · runs first' },
    { id: 'deobfuscate', enabled: true, label: 'Deobfuscation', description: 'apply selected engine · Webcrack may run extracted JS in a worker (see pipeline panel)' },
    { id: 'parse', enabled: true, label: 'AST parse + index', description: 'build symbol table · count refs · flag suspicious' },
  ],
  engine: 'webcrack',
  printWidth: 100,
  indentSize: 2,
  parseJsx: false,
  parseTypescript: false,
  includeAstTree: true,
  wakaruAggressive: false,
};

export default function App() {
  const [input, setInput] = useState<string>(SAMPLE_OBFUSCATED);
  const [output, setOutput] = useState<string>('');
  const [fileName, setFileName] = useState<string | null>('sample.obfuscated.js');
  const [config, setConfig] = useState<PipelineConfig>(DEFAULT_CONFIG);
  const [log, setLog] = useState<LogEntry[]>([
    { ts: INITIAL_LOG_TS, level: 'info', source: 'init', message: 'workbench ready · load .js input or paste in the editor · run pipeline to begin' },
  ]);
  const [summary, setSummary] = useState<ParseSummary | null>(null);
  const [renameOps, setRenameOps] = useState<RenameOp[]>([]);
  const [showPipeline, setShowPipeline] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showStrings, setShowStrings] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [obfHighlight, setObfHighlight] = useState(true);
  const [dragOver, setDragOver] = useState<'left' | 'right' | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationsPrefocus, setAnnotationsPrefocus] = useState<SymbolInfo | null>(null);
  const [rightPaneMode, setRightPaneMode] = useState<'output' | 'diff'>('output');
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  useEffect(() => {
    persistAppSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (settings.theme === 'default') {
      document.documentElement.removeAttribute('data-app-theme');
    } else {
      document.documentElement.dataset.appTheme = settings.theme;
    }
  }, [settings.theme]);

  const [hydrated, setHydrated] = useState(() => !loadAppSettings().autosaveEnabled);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const renameMapInputRef = useRef<HTMLInputElement>(null);
  const outputEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const inputEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const outputTextRef = useRef(output);
  const summaryRefreshTimerRef = useRef<number | null>(null);
  const summaryRefreshEpochRef = useRef(0);
  const outputRenameUndoFramesRef = useRef<OutputRenameUndoFrame[]>([]);
  const renameUndoUiRef = useRef<{
    appendLog: (entries: LogEntry[]) => void;
    scheduleSummaryRefresh: (code: string) => void;
  }>({
    appendLog: () => {},
    scheduleSummaryRefresh: () => {},
  });
  const renameBridgeRef = useRef<OutputRenameBridge>({
    appendLog: () => {},
    setRenameOps: () => {},
  });
  const formatBridgeRef = useRef<FormatBridge>({
    getFormatOptions: () => ({ indentSize: 2, printWidth: 100 }),
  });
  const { run, renameBusy, execute, renameBatch } = usePipeline();

  const appendLog = useCallback((entries: LogEntry[]) => {
    setLog((prev) => [...prev, ...entries].slice(-2000));
  }, []);

  const clearOutputRenameUndoFrames = useCallback(() => {
    outputRenameUndoFramesRef.current = [];
  }, []);

  const outputBindingNotesBridgeRef = useRef<OutputBindingNotesBridgeRef>({
    getSymbols: () => [],
    getIndexedParseLength: () => null,
    refreshIndexedSymbols: async () => null,
    onOpenBindingNotes: () => {},
    onUnresolvedBinding: () => {},
  });
  const getOutputBindingNotesBridge = useCallback(() => outputBindingNotesBridgeRef.current, []);
  const clearAnnotationsPrefocus = useCallback(() => setAnnotationsPrefocus(null), []);

  const scheduleSummaryRefresh = useCallback((code: string) => {
    if (summaryRefreshTimerRef.current != null) {
      window.clearTimeout(summaryRefreshTimerRef.current);
    }
    summaryRefreshTimerRef.current = window.setTimeout(() => {
      summaryRefreshTimerRef.current = null;
      const epoch = ++summaryRefreshEpochRef.current;
      renameBatch(code, [], config).then((result) => {
        if (epoch !== summaryRefreshEpochRef.current) return;
        if (result.summary) setSummary(result.summary);
      });
    }, 200);
  }, [renameBatch, config]);

  useEffect(() => {
    renameUndoUiRef.current.appendLog = appendLog;
    renameUndoUiRef.current.scheduleSummaryRefresh = scheduleSummaryRefresh;
  }, [appendLog, scheduleSummaryRefresh]);

  useEffect(() => {
    renameBridgeRef.current.appendLog = appendLog;
    renameBridgeRef.current.setRenameOps = setRenameOps;
    renameBridgeRef.current.recordOutputRenameFrame = (frame) => {
      outputRenameUndoFramesRef.current.push({ ...frame, active: true });
    };
    renameBridgeRef.current.onRenamed = ({ from, to, scopePath, codeAfterRename }) => {
      setAnnotations((prev) => migrateAnnotationOnRename(prev, from, to, scopePath));
      scheduleSummaryRefresh(codeAfterRename);
    };
    formatBridgeRef.current.getFormatOptions = () => ({
      indentSize: config.indentSize,
      printWidth: config.printWidth,
    });
  }, [appendLog, config.indentSize, config.printWidth, scheduleSummaryRefresh]);

  useEffect(() => {
    const bridge = outputBindingNotesBridgeRef.current;
    bridge.getSymbols = () => summary?.symbols ?? [];
    bridge.getIndexedParseLength = () => summary?.parseSourceLength ?? null;
    bridge.refreshIndexedSymbols = async () => {
      const code = outputEditorRef.current?.getModel()?.getValue() ?? outputTextRef.current ?? '';
      const result = await renameBatch(code, [], config);
      if (result.summary) {
        setSummary(result.summary);
        const parseSourceLength = result.summary.parseSourceLength ?? code.length;
        return {
          symbols: result.summary.symbols ?? [],
          parseSourceLength,
        };
      }
      if (result.log.length > 0) {
        appendLog(result.log);
      }
      return null;
    };
    bridge.onOpenBindingNotes = (sym) => {
      setAnnotationsPrefocus(sym);
      setShowAnnotations(true);
    };
    bridge.onUnresolvedBinding = (hint) => {
      appendLog([{ ts: Date.now(), level: 'warn', source: 'notes', message: hint }]);
    };
  }, [summary, renameBatch, config, appendLog]);

  useEffect(() => {
    outputTextRef.current = output;
  }, [output]);

  useEffect(() => {
    let cancelled = false;

    if (!loadAppSettings().autosaveEnabled) {
      return;
    }

    loadSession<ProjectFile>().then((raw) => {
      if (cancelled) return;
      if (raw && isProjectFile(raw)) {
        const proj = normalizeProject(raw);
        outputRenameUndoFramesRef.current = [];
        setInput(proj.input);
        setOutput(proj.output);
        setFileName(proj.fileName);
        setConfig(proj.config);
        setRenameOps(proj.renames);
        setAnnotations(proj.annotations);
        appendLog([{
          ts: Date.now(),
          level: 'ok',
          source: 'session',
          message: `restored autosaved session · ${proj.input.length} chars in · ${proj.renames.length} renames · ${proj.annotations.length} notes`,
        }]);
        renameBatch(proj.output, [], proj.config).then((parseOnly) => {
          if (cancelled) return;
          if (parseOnly.summary) setSummary(parseOnly.summary);
        });
      }
      setHydrated(true);
    }).catch(() => setHydrated(true));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sessionPayload = useMemo(
    () => buildProjectFile({ fileName, input, output, config, renames: renameOps, annotations }),
    [fileName, input, output, config, renameOps, annotations],
  );
  useAutosave(sessionPayload, {
    enabled: hydrated && settings.autosaveEnabled,
    delayMs: 800,
    onError: (e) => appendLog([{ ts: Date.now(), level: 'warn', source: 'session', message: `autosave failed: ${e instanceof Error ? e.message : e}` }]),
  });

  const revealInOutput = useCallback((req: OutputRevealRequest) => {
    const ed = outputEditorRef.current;
    const model = ed?.getModel();
    if (!ed || !model || req.parseSourceLength < 1) return;

    if (model.getValueLength() !== req.parseSourceLength) {
      const snap = outputTextRef.current;
      if (snap.length !== req.parseSourceLength) return;
      model.setValue(snap);
    }

    let range: Range | null = null;
    if (
      req.rangeStartLineNumber != null &&
      req.rangeStartColumn != null &&
      req.rangeEndLineNumber != null &&
      req.rangeEndColumn != null
    ) {
      range = new Range(
        req.rangeStartLineNumber,
        req.rangeStartColumn,
        req.rangeEndLineNumber,
        req.rangeEndColumn,
      );
    } else if (req.startOffset != null && req.endOffset != null && req.endOffset > req.startOffset) {
      const max = model.getValueLength();
      const s = Math.max(0, Math.min(req.startOffset, max));
      const e = Math.max(s, Math.min(req.endOffset, max));
      const p0 = model.getPositionAt(s);
      const p1 = model.getPositionAt(e);
      range = new Range(p0.lineNumber, p0.column, p1.lineNumber, p1.column);
    }
    if (!range) return;

    ed.setSelection(range);
    ed.revealRangeInCenter(range);
    ed.focus();
  }, []);

  const outputNoteGutterMarks = useMemo(() => {
    const symbols = summary?.symbols;
    if (!symbols?.length || annotations.length === 0) return [];
    const byLine = new Map<number, string[]>();
    for (const ann of annotations) {
      const sym = symbols.find((s) => s.name === ann.name && s.scopePath === ann.scopePath);
      const line = sym?.rangeStartLineNumber ?? sym?.definitionLine;
      if (line == null || line < 1) continue;

      const scopeShort =
        ann.scopePath.length > 96 ? `${ann.scopePath.slice(0, 96)}…` : ann.scopePath;
      const bits: string[] = [`**${ann.name}** · \`${scopeShort}\``];
      if (ann.tag?.trim()) bits.push(`Tag: **${ann.tag.trim()}**`);
      if (ann.note.trim()) bits.push(ann.note.trim());
      const hover = bits.join('\n\n');

      const arr = byLine.get(line) ?? [];
      arr.push(hover);
      byLine.set(line, arr);
    }

    const out: { lineNumber: number; hoverMarkdown: string }[] = [];
    for (const [line, hovers] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
      out.push({
        lineNumber: line,
        hoverMarkdown: hovers.length > 1 ? hovers.join('\n\n---\n\n') : hovers[0]!,
      });
    }
    return out;
  }, [summary?.symbols, annotations]);

  const onInputEditorMount = useCallback((ed: editor.IStandaloneCodeEditor) => {
    inputEditorRef.current = ed;
    ed.onDidDispose(() => {
      if (inputEditorRef.current === ed) inputEditorRef.current = null;
    });
  }, []);

  const onOutputEditorMount = useCallback((ed: editor.IStandaloneCodeEditor) => {
    outputEditorRef.current = ed;
    const model = ed.getModel();
    if (!model) return;

    const disposable = model.onDidChangeContent((e) => {
      if (!e.isUndoing && !e.isRedoing) return;
      const value = model.getValue();
      const frames = outputRenameUndoFramesRef.current;
      const ui = renameUndoUiRef.current;

      if (e.isUndoing) {
        for (let i = frames.length - 1; i >= 0; i--) {
          const f = frames[i];
          if (f.active && f.before === value) {
            f.active = false;
            const op = f.op;
            setRenameOps((prev) => {
              const idx = prev.findLastIndex((p) => renameOpsEquivalent(p, op));
              if (idx === -1) return prev;
              return prev.slice(0, idx).concat(prev.slice(idx + 1));
            });
            setAnnotations((prev) => migrateAnnotationOnRename(prev, op.to, op.from, op.scopePath));
            ui.appendLog([
              {
                ts: Date.now(),
                level: 'info',
                source: 'rename',
                message: `undo · synced rename map · "${op.to}" → "${op.from}"`,
              },
            ]);
            ui.scheduleSummaryRefresh(value);
            break;
          }
        }
      } else if (e.isRedoing) {
        for (let i = frames.length - 1; i >= 0; i--) {
          const f = frames[i];
          if (!f.active && f.after === value) {
            f.active = true;
            const op = f.op;
            setRenameOps((prev) => [...prev, op]);
            setAnnotations((prev) => migrateAnnotationOnRename(prev, op.from, op.to, op.scopePath));
            ui.appendLog([
              {
                ts: Date.now(),
                level: 'info',
                source: 'rename',
                message: `redo · synced rename map · "${op.from}" → "${op.to}"`,
              },
            ]);
            ui.scheduleSummaryRefresh(value);
            break;
          }
        }
      }
    });

    ed.onDidDispose(() => {
      disposable.dispose();
      if (outputEditorRef.current === ed) outputEditorRef.current = null;
    });
  }, []);

  const onInputMonacoBeforeMount = useCallback((monaco: Monaco) => {
    registerOutputRenameProvider(monaco, () => renameBridgeRef.current);
    registerJsFormatProvider(monaco, () => formatBridgeRef.current);
  }, []);

  useEffect(() => () => {
    disposeOutputRenameProvider();
    disposeJsFormatProvider();
  }, []);

  const onRun = useCallback(async () => {
    if (run.running) return;
    appendLog([{ ts: Date.now(), level: 'info', source: 'ui', message: `> run · ${config.engine} · ${config.steps.filter(s => s.enabled).map(s => s.id).join(' → ')}` }]);
    const result = await execute(input, config);
    clearOutputRenameUndoFrames();
    setOutput(result.output);
    const formattedIn = result.formattedInput;
    if (formattedIn != null) setInput(formattedIn);
    setSummary(result.summary);
    appendLog(result.log);
    const didFormatInput = formattedIn != null;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resetEditorViewportToStart(outputEditorRef.current);
        if (didFormatInput) resetEditorViewportToStart(inputEditorRef.current);
      });
    });
  }, [run.running, input, config, execute, appendLog, clearOutputRenameUndoFrames]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        onRun();
      } else if (e.key === 'Escape') {
        setShowPipeline(false);
        setShowQueue(false);
        setShowStrings(false);
        setShowAnnotations(false);
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        setShowPipeline((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRun]);

  function triggerLoad() {
    fileInputRef.current?.click();
  }
  async function onFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      appendLog([{ ts: Date.now(), level: 'warn', source: 'file', message: `large file (${(file.size / 1024 / 1024).toFixed(1)}MB) · processing may take time` }]);
    }
    const text = await file.text();
    setInput(text);
    setFileName(file.name);
    clearOutputRenameUndoFrames();
    setOutput('');
    setSummary(null);
    appendLog([{ ts: Date.now(), level: 'ok', source: 'file', message: `loaded ${file.name} · ${file.size} bytes` }]);
  }

  function onExport() {
    const code = output || input;
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = fileName ? fileName.replace(/\.(js|mjs|cjs|ts)$/i, '') : 'decloaked';
    a.href = url;
    a.download = `${base}.cleaned.js`;
    a.click();
    URL.revokeObjectURL(url);
    appendLog([{ ts: Date.now(), level: 'ok', source: 'export', message: `wrote ${base}.cleaned.js` }]);
  }

  function onExportMap() {
    const entries: RenameMapEntry[] = renameOps.map((op) => ({
      from: op.from,
      to: op.to,
      ...(op.scopePath ? { scopePath: op.scopePath } : {}),
    }));
    const payload = {
      kind: 'jsdecloak-rename-map',
      version: 1,
      savedAt: Date.now(),
      entries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rename-map.json`;
    a.click();
    URL.revokeObjectURL(url);
    appendLog([{ ts: Date.now(), level: 'ok', source: 'export', message: `wrote rename-map.json · ${entries.length} entries (scope-aware)` }]);
  }

  async function onLoadRenameMap(file: File) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch (e) {
      appendLog([{ ts: Date.now(), level: 'err', source: 'rename-map', message: `parse failed: ${e instanceof Error ? e.message : e}` }]);
      return;
    }

    let entries: RenameMapEntry[] = [];
    if (parsed && typeof parsed === 'object' && 'entries' in parsed && Array.isArray((parsed as { entries: unknown }).entries)) {
      entries = ((parsed as { entries: unknown[] }).entries).filter(
        (e): e is RenameMapEntry =>
          !!e && typeof e === 'object' && typeof (e as RenameMapEntry).from === 'string' && typeof (e as RenameMapEntry).to === 'string',
      );
    } else if (parsed && typeof parsed === 'object') {
      for (const [from, to] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof to === 'string') entries.push({ from, to });
      }
    } else {
      appendLog([{ ts: Date.now(), level: 'err', source: 'rename-map', message: 'unrecognized rename-map format' }]);
      return;
    }

    if (entries.length === 0) {
      appendLog([{ ts: Date.now(), level: 'warn', source: 'rename-map', message: 'rename-map contained no entries' }]);
      return;
    }

    const target = output || input;
    clearOutputRenameUndoFrames();
    const opsForWorker = entries.map((e) => ({
      from: e.from,
      to: e.to,
      ...(e.scopePath ? { scopePath: e.scopePath } : {}),
    }));
    const result = await renameBatch(target, opsForWorker, config);
    setOutput(result.code);
    if (result.summary) setSummary(result.summary);
    setRenameOps((prev) => [
      ...prev,
      ...result.applied.map((a) => ({ from: a.from, to: a.to, ts: Date.now(), scopePath: a.scopePath })),
    ]);
    setAnnotations((prev) => {
      let next = prev;
      for (const a of result.applied) {
        next = migrateAnnotationOnRename(next, a.from, a.to, a.scopePath);
      }
      return next;
    });
    appendLog([
      ...result.log,
      { ts: Date.now(), level: 'ok', source: 'rename-map', message: `applied ${result.applied.length}/${entries.length} entries` },
      ...(result.skipped.length > 0
        ? [{ ts: Date.now(), level: 'warn' as const, source: 'rename-map', message: `skipped ${result.skipped.length}: ${result.skipped.slice(0, 5).map((s) => s.from).join(', ')}${result.skipped.length > 5 ? '…' : ''}` }]
        : []),
    ]);
  }

  function onExportProject() {
    const payload = buildProjectFile({ fileName, input, output, config, renames: renameOps, annotations });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = fileName ? fileName.replace(/\.(js|mjs|cjs|ts|json)$/i, '') : 'session';
    a.href = url;
    a.download = `${base}.jsdecloak.json`;
    a.click();
    URL.revokeObjectURL(url);
    appendLog([{ ts: Date.now(), level: 'ok', source: 'project', message: `wrote ${base}.jsdecloak.json · ${renameOps.length} renames · ${annotations.length} notes` }]);
  }

  async function onLoadProject(file: File) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch (e) {
      appendLog([{ ts: Date.now(), level: 'err', source: 'project', message: `parse failed: ${e instanceof Error ? e.message : e}` }]);
      return;
    }
    if (!isProjectFile(parsed)) {
      appendLog([{ ts: Date.now(), level: 'err', source: 'project', message: 'not a JSDecloak project file' }]);
      return;
    }
    const proj = normalizeProject(parsed);
    clearOutputRenameUndoFrames();
    setInput(proj.input);
    setOutput(proj.output);
    setFileName(proj.fileName);
    setConfig(proj.config);
    setRenameOps(proj.renames);
    setAnnotations(proj.annotations);
    appendLog([{ ts: Date.now(), level: 'ok', source: 'project', message: `loaded project · ${proj.input.length} chars · ${proj.renames.length} renames · ${proj.annotations.length} notes` }]);
    const parseResult = await renameBatch(proj.output, [], proj.config);
    if (parseResult.summary) setSummary(parseResult.summary);
  }

  async function onResetSession() {
    if (!confirm('Clear autosave and reset workbench? Unsaved annotations and renames will be lost.')) return;
    await clearSession().catch(() => undefined);
    clearOutputRenameUndoFrames();
    setInput(SAMPLE_OBFUSCATED);
    setOutput('');
    setFileName('sample.obfuscated.js');
    setConfig(DEFAULT_CONFIG);
    setRenameOps([]);
    setAnnotations([]);
    setSummary(null);
    appendLog([{ ts: Date.now(), level: 'info', source: 'session', message: 'reset · autosave cleared' }]);
  }

  function onDragOver(e: React.DragEvent, side: 'left' | 'right') {
    e.preventDefault();
    setDragOver(side);
  }
  function onDragLeave() {
    setDragOver(null);
  }
  async function onDrop(e: React.DragEvent, side: 'left' | 'right') {
    e.preventDefault();
    setDragOver(null);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (side === 'left') {
      await onFile(file);
    } else {
      const text = await file.text();
      clearOutputRenameUndoFrames();
      setOutput(text);
      appendLog([{ ts: Date.now(), level: 'info', source: 'drop', message: `loaded ${file.name} into output pane (read-only result)` }]);
    }
  }

  async function applyQueueRenames(
    opsRaw: Array<{ from: string; to: string; scopePath?: string; position?: { line: number; column: number } }>,
  ) {
    clearOutputRenameUndoFrames();
    const target = output || input;
    appendLog([{ ts: Date.now(), level: 'info', source: 'rename', message: `batch · sending ${opsRaw.length} ops to worker` }]);
    const result = await renameBatch(target, opsRaw, config);
    setOutput(result.code);
    if (result.summary) setSummary(result.summary);
    const appliedOps: RenameOp[] = result.applied.map((a) => ({
      from: a.from,
      to: a.to,
      ts: Date.now(),
      scopePath: a.scopePath,
    }));
    setRenameOps((prev) => [...prev, ...appliedOps]);
    setAnnotations((prev) => {
      let next = prev;
      for (const op of appliedOps) {
        next = migrateAnnotationOnRename(next, op.from, op.to, op.scopePath);
      }
      return next;
    });
    appendLog([
      ...result.log,
      { ts: Date.now(), level: 'ok', source: 'rename', message: `batch · ${result.applied.length} applied / ${result.skipped.length} skipped` },
    ]);
  }

  const outputSize = useMemo(() => new Blob([output || '']).size, [output]);
  const inputSize = useMemo(() => new Blob([input || '']).size, [input]);

  return (
    <div className="h-screen flex flex-col relative scanlines grid-bg" style={{ background: 'var(--color-ink-0)' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".js,.mjs,.cjs,.ts,application/javascript,text/javascript,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={projectInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onLoadProject(f);
          e.target.value = '';
        }}
      />
      <input
        ref={renameMapInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onLoadRenameMap(f);
          e.target.value = '';
        }}
      />

      <Toolbar
        fileName={fileName}
        inputSize={inputSize}
        outputSize={outputSize}
        engine={config.engine}
        running={run.running}
        progressPercent={run.percent}
        currentStep={run.step}
        onLoad={triggerLoad}
        onRun={onRun}
        onExport={onExport}
        onExportMap={onExportMap}
        onLoadMap={() => renameMapInputRef.current?.click()}
        onExportProject={onExportProject}
        onLoadProject={() => projectInputRef.current?.click()}
        onResetSession={onResetSession}
        onOpenPipeline={() => setShowPipeline(true)}
        onOpenRenameQueue={() => setShowQueue(true)}
        onOpenStrings={() => setShowStrings(true)}
        onOpenAnnotations={() => {
          setAnnotationsPrefocus(null);
          setShowAnnotations(true);
        }}
        rightPaneMode={rightPaneMode}
        onToggleRightPane={() => setRightPaneMode((m) => (m === 'output' ? 'diff' : 'output'))}
        stringCount={summary?.strings?.length ?? 0}
        annotationCount={annotations.length}
        obfHighlight={obfHighlight}
        onToggleHighlight={setObfHighlight}
        autosaveEnabled={settings.autosaveEnabled}
        onToggleAutosave={() => setSettings((s) => ({ ...s, autosaveEnabled: !s.autosaveEnabled }))}
        theme={settings.theme}
        onSetTheme={(t) => setSettings((s) => ({ ...s, theme: t }))}
      />

      <div className="flex-1 min-h-0 flex flex-col">
        <div style={{ flex: '1 1 0', minHeight: 0 }} className="relative">
          {rightPaneMode === 'diff' ? (
            <div
              onDragOver={(e) => onDragOver(e, 'left')}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, 'left')}
              className={`h-full flex flex-col min-h-0 relative ${dragOver === 'left' ? 'dropzone-active' : ''}`}
            >
              <PaneHeader
                side="right"
                title="diff · input (original) vs output (modified)"
                meta={
                  output
                    ? `${input.length} chars in · ${output.length} chars out · ${summary?.obfuscatedCount ?? 0} flagged in parse`
                    : `${input.length} chars in · awaiting pipeline run for output`
                }
              />
              <div className="flex-1 min-h-0 relative">
                {run.running && (
                  <div className="absolute inset-x-0 top-0 z-10">
                    <div className="h-0.5 bg-line">
                      <div className="h-full bg-amber transition-all" style={{ width: `${run.percent}%` }} />
                    </div>
                  </div>
                )}
                {!output && !run.running && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                    <div className="text-center txt-bone-4">
                      <div className="text-[40px] mb-4" style={{ fontFamily: 'var(--font-display)' }}>∅</div>
                      <div className="text-[11px] uppercase tracking-[0.18em]">no output yet</div>
                      <div className="text-[10px] mt-2">press <kbd>⌘ ↵</kbd> or click run</div>
                    </div>
                  </div>
                )}
                <DiffPane original={input} modified={output} monacoThemeId={monacoThemeIdForAppTheme(settings.theme)} />
              </div>
            </div>
          ) : (
            <Splitter
              direction="vertical"
              initial={50}
              first={
                <div
                  onDragOver={(e) => onDragOver(e, 'left')}
                  onDragLeave={onDragLeave}
                  onDrop={(e) => onDrop(e, 'left')}
                  className={`h-full flex flex-col ${dragOver === 'left' ? 'dropzone-active' : ''}`}
                  style={{ borderRight: '1px solid var(--color-line)' }}
                >
                  <PaneHeader
                    side="left"
                    title="input · obfuscated"
                    meta={`${input.length} chars · ${input.split('\n').length} lines`}
                  />
                  <div className="flex-1 min-h-0">
                    <CodeEditor
                      value={input}
                      onChange={setInput}
                      highlightObfuscated={obfHighlight}
                      disableRename
                      path="jsdecloak-input/source.js"
                      beforeMount={onInputMonacoBeforeMount}
                      onMount={onInputEditorMount}
                      language="javascript"
                      appTheme={settings.theme}
                    />
                  </div>
                </div>
              }
              second={
                <div
                  onDragOver={(e) => onDragOver(e, 'right')}
                  onDragLeave={onDragLeave}
                  onDrop={(e) => onDrop(e, 'right')}
                  className={`h-full flex flex-col ${dragOver === 'right' ? 'dropzone-active' : ''}`}
                >
                  <PaneHeader
                    side="right"
                    title="output · cleaned"
                    meta={
                      output
                        ? `${output.length} chars · ${output.split('\n').length} lines · ${summary?.obfuscatedCount ?? 0} flagged`
                        : 'awaiting pipeline run'
                    }
                  />
                  <div className="flex-1 min-h-0 relative">
                    {!output && !run.running && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                        <div className="text-center txt-bone-4">
                          <div className="text-[40px] mb-4" style={{ fontFamily: 'var(--font-display)' }}>∅</div>
                          <div className="text-[11px] uppercase tracking-[0.18em]">no output yet</div>
                          <div className="text-[10px] mt-2">press <kbd>⌘ ↵</kbd> or click run</div>
                        </div>
                      </div>
                    )}
                    {run.running && (
                      <div className="absolute inset-x-0 top-0 z-10">
                        <div className="h-0.5 bg-line">
                          <div className="h-full bg-amber transition-all" style={{ width: `${run.percent}%` }} />
                        </div>
                      </div>
                    )}
                    <CodeEditor
                      value={output}
                      onChange={setOutput}
                      highlightObfuscated={obfHighlight}
                      path="jsdecloak-output/deobfuscated.js"
                      language="javascript"
                      bindingNotesBridge={getOutputBindingNotesBridge}
                      onMount={onOutputEditorMount}
                      noteGutterMarks={outputNoteGutterMarks}
                      appTheme={settings.theme}
                    />
                  </div>
                </div>
              }
            />
          )}
        </div>

        <BottomDrawer
          log={log}
          summary={summary}
          renames={renameOps}
          onClear={() => {
            setLog([]);
          }}
          onRevealInOutput={revealInOutput}
        />
      </div>

      <div className="flex items-center justify-between px-3 py-1 border-t text-[10px] txt-bone-3" style={{ borderColor: 'var(--color-line)', background: 'var(--color-ink-1)' }}>
        <div className="flex items-center gap-3">
          <span className={run.running ? 'txt-amber' : 'txt-matrix'}>● {run.running ? 'busy' : 'idle'}</span>
          <span>engine: <span className="txt-bone-1">{config.engine}</span></span>
          <span>steps: <span className="txt-bone-1">{config.steps.filter((s) => s.enabled).length}/{config.steps.length}</span></span>
          {summary?.ok && <span>parse: <span className="txt-matrix">ok</span></span>}
          {summary && !summary.ok && <span>parse: <span className="txt-rust">err</span></span>}
        </div>
        <div className="flex items-center gap-3">
          <span>renames: <span className="txt-bone-1">{renameOps.length}</span></span>
          <span><kbd>⌘ ↵</kbd> run · <kbd>⌘ ⇧ p</kbd> pipeline · <kbd>F2</kbd> rename (output)</span>
        </div>
      </div>

      {showPipeline && (
        <PipelinePanel
          config={config}
          onChange={setConfig}
          onClose={() => setShowPipeline(false)}
        />
      )}
      {showQueue && (
        <RenameQueue
          code={output || input}
          onApply={applyQueueRenames}
          onClose={() => setShowQueue(false)}
          busy={renameBusy}
        />
      )}
      {showStrings && summary?.strings && (
        <StringsPanel
          strings={summary.strings}
          parseSourceLength={summary.parseSourceLength ?? output.length}
          onClose={() => setShowStrings(false)}
          onReveal={(req) => {
            if (rightPaneMode !== 'output') setRightPaneMode('output');
            revealInOutput(req);
            setShowStrings(false);
          }}
        />
      )}
      {showAnnotations && (
        <AnnotationsPanel
          symbols={summary?.symbols ?? []}
          annotations={annotations}
          parseSourceLength={summary?.parseSourceLength ?? output.length}
          onChange={setAnnotations}
          onClose={() => {
            setShowAnnotations(false);
            setAnnotationsPrefocus(null);
          }}
          onReveal={(req) => {
            if (rightPaneMode !== 'output') setRightPaneMode('output');
            revealInOutput(req);
            setShowAnnotations(false);
          }}
          prefocusBinding={annotationsPrefocus}
          onPrefocusConsumed={clearAnnotationsPrefocus}
        />
      )}
    </div>
  );
}

function PaneHeader({ title, meta, side }: { title: string; meta: string; side: 'left' | 'right' }) {
  return (
    <div className="panel-header">
      <span className="flex items-center gap-2">
        <span className={side === 'left' ? 'txt-rust' : 'txt-matrix'}>{side === 'left' ? '◧' : '◨'}</span>
        {title}
      </span>
      <span className="txt-bone-4 normal-case tracking-normal">{meta}</span>
    </div>
  );
}
