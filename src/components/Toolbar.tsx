import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppTheme } from '../utils/appSettings';
import { APP_THEMES } from '../utils/appSettings';

interface Props {
  fileName: string | null;
  inputSize: number;
  outputSize: number;
  engine: string;
  running: boolean;
  progressPercent: number;
  currentStep: string | null;
  onLoad: () => void;
  onRun: () => void;
  onExport: () => void;
  onExportMap: () => void;
  onLoadMap: () => void;
  onExportProject: () => void;
  onLoadProject: () => void;
  onResetSession: () => void;
  onOpenPipeline: () => void;
  onOpenRenameQueue: () => void;
  onOpenStrings: () => void;
  onOpenAnnotations: () => void;
  rightPaneMode: 'output' | 'diff';
  onToggleRightPane: () => void;
  stringCount: number;
  annotationCount: number;
  obfHighlight: boolean;
  onToggleHighlight: (v: boolean) => void;
  autosaveEnabled: boolean;
  onToggleAutosave: () => void;
  theme: AppTheme;
  onSetTheme: (t: AppTheme) => void;
}

type MenuId = 'file' | 'pipeline' | 'tools' | 'view' | 'settings';

function fmtBytes(n: number) {
  if (n < 1024) return `${n} b`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kb`;
  return `${(n / 1024 / 1024).toFixed(2)} mb`;
}

function IconPlay() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

function IconGear() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5z" />
    </svg>
  );
}

function IconNotes() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </svg>
  );
}

function IconRename() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  );
}

export function Toolbar(props: Props) {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [themeFlyoutClick, setThemeFlyoutClick] = useState(false);
  const [themeFlyoutHover, setThemeFlyoutHover] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const showThemeFlyout = themeFlyoutClick || themeFlyoutHover;

  const close = useCallback(() => setOpenMenu(null), []);

  useEffect(() => {
    if (openMenu !== 'settings') {
      setThemeFlyoutClick(false);
      setThemeFlyoutHover(false);
    }
  }, [openMenu]);

  useEffect(() => {
    if (openMenu == null) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  const toggle = (id: MenuId) => {
    setOpenMenu((m) => (m === id ? null : id));
  };

  const runLabel = props.running
    ? `Running · ${props.currentStep ?? ''} ${Math.round(props.progressPercent)}%`
    : 'Run pipeline';

  const runTitle = props.running
    ? runLabel
    : `Run pipeline · ⌘↵ or Ctrl+Enter · engine: ${props.engine}`;

  return (
    <div ref={barRef} className="menubar px-0 py-0 gap-0">
      <div className="menubar-left">
        <div className="menubar-brand">
        <img src="/favicon.svg" width={16} height={16} alt="" className="shrink-0 block" draggable={false} />
        <span className="font-medium tracking-wide text-[color:var(--color-bone-1)]">
          JSDecloak
        </span>
      </div>

      <div className="menubar-menus" role="menubar">
        <div className="menu-root">
          <button
            type="button"
            className="menu-trigger"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'file'}
            onClick={() => toggle('file')}
          >
            File
          </button>
          {openMenu === 'file' && (
            <div className="menu-panel" role="menu">
              <button type="button" className="menu-item" role="menuitem" onClick={() => { props.onLoad(); close(); }}>
                Load file…
              </button>
              <button type="button" className="menu-item" role="menuitem" onClick={() => { props.onExport(); close(); }}>
                Export JavaScript…
              </button>
              <hr className="menu-sep" />
              <button type="button" className="menu-item" role="menuitem" onClick={() => { props.onExportProject(); close(); }}>
                Save project…
              </button>
              <button type="button" className="menu-item" role="menuitem" onClick={() => { props.onLoadProject(); close(); }}>
                Open project…
              </button>
              <hr className="menu-sep" />
              <button type="button" className="menu-item" role="menuitem" onClick={() => { props.onLoadMap(); close(); }}>
                Import rename map…
              </button>
              <button type="button" className="menu-item" role="menuitem" onClick={() => { props.onExportMap(); close(); }}>
                Export rename map…
              </button>
            </div>
          )}
        </div>

        <div className="menu-root">
          <button
            type="button"
            className="menu-trigger"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'pipeline'}
            onClick={() => toggle('pipeline')}
          >
            Pipeline
          </button>
          {openMenu === 'pipeline' && (
            <div className="menu-panel" role="menu">
              <button type="button" className="menu-item" role="menuitem" onClick={() => { props.onOpenPipeline(); close(); }}>
                Configure pipeline…
                <span className="menu-hint">{props.engine}</span>
              </button>
              <hr className="menu-sep" />
              <button
                type="button"
                className="menu-item"
                role="menuitem"
                disabled={props.running}
                onClick={() => { props.onRun(); close(); }}
              >
                Run pipeline
                <span className="menu-hint">⌘ ↵</span>
              </button>
            </div>
          )}
        </div>

        <div className="menu-root">
          <button
            type="button"
            className="menu-trigger"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'tools'}
            onClick={() => toggle('tools')}
          >
            Tools
          </button>
          {openMenu === 'tools' && (
            <div className="menu-panel" role="menu">
              <button type="button" className="menu-item" role="menuitem" onClick={() => { props.onOpenRenameQueue(); close(); }}>
                Rename queue…
              </button>
              <button type="button" className="menu-item" role="menuitem" onClick={() => { props.onOpenAnnotations(); close(); }}>
                Binding notes…
                {props.annotationCount > 0 && <span className="menu-hint">{props.annotationCount}</span>}
              </button>
              <button
                type="button"
                className="menu-item"
                role="menuitem"
                disabled={props.stringCount === 0}
                title={props.stringCount === 0 ? 'Run pipeline with parse step to populate' : undefined}
                onClick={() => { props.onOpenStrings(); close(); }}
              >
                Strings…
                {props.stringCount > 0 && <span className="menu-hint">{props.stringCount}</span>}
              </button>
            </div>
          )}
        </div>

        <div className="menu-root">
          <button
            type="button"
            className="menu-trigger"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'view'}
            onClick={() => toggle('view')}
          >
            View
          </button>
          {openMenu === 'view' && (
            <div className="menu-panel" role="menu">
              <button
                type="button"
                className="menu-item-check"
                role="menuitemcheckbox"
                aria-checked={props.rightPaneMode === 'diff'}
                onClick={() => {
                  props.onToggleRightPane();
                  close();
                }}
              >
                <span className="menu-check">{props.rightPaneMode === 'diff' ? '✓' : ''}</span>
                Diff view (full width)
              </button>
              <button
                type="button"
                className="menu-item-check"
                role="menuitemcheckbox"
                aria-checked={props.obfHighlight}
                onClick={() => {
                  props.onToggleHighlight(!props.obfHighlight);
                  close();
                }}
              >
                <span className="menu-check">{props.obfHighlight ? '✓' : ''}</span>
                Highlight obfuscated tokens
              </button>
            </div>
          )}
        </div>

        <div className="menu-root">
          <button
            type="button"
            className="menu-trigger"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'settings'}
            onClick={() => toggle('settings')}
          >
            Settings
          </button>
          {openMenu === 'settings' && (
            <div className="menu-panel" role="menu">
              <button
                type="button"
                className="menu-item-check"
                role="menuitemcheckbox"
                aria-checked={props.autosaveEnabled}
                onClick={() => {
                  props.onToggleAutosave();
                }}
              >
                <span className="menu-check">{props.autosaveEnabled ? '✓' : ''}</span>
                Autosave session
              </button>
              <div
                className="menu-submenu-host"
                onMouseEnter={() => setThemeFlyoutHover(true)}
                onMouseLeave={() => setThemeFlyoutHover(false)}
              >
                <button
                  type="button"
                  className="menu-submenu-trigger"
                  aria-expanded={showThemeFlyout}
                  aria-haspopup="menu"
                  onClick={(e) => {
                    e.stopPropagation();
                    setThemeFlyoutClick((v) => !v);
                  }}
                >
                  <span>Theme</span>
                  <span className="menu-submenu-chevron" aria-hidden>
                    ▸
                  </span>
                </button>
                {showThemeFlyout && (
                  <div className="menu-submenu-flyout" role="menu">
                    {APP_THEMES.map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        className="menu-item-check"
                        role="menuitemradio"
                        aria-checked={props.theme === id}
                        onClick={() => {
                          props.onSetTheme(id);
                          setThemeFlyoutClick(false);
                          setThemeFlyoutHover(false);
                          close();
                        }}
                      >
                        <span className="menu-check">{props.theme === id ? '✓' : ''}</span>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      </div>

      <div className="menubar-center" aria-label="Quick tools">
        <button
          type="button"
          className="toolbar-icon-btn"
          onClick={() => {
            props.onOpenPipeline();
            close();
          }}
          title={`Configure pipeline · ${props.engine}`}
          aria-label="Configure pipeline"
        >
          <IconGear />
        </button>
        <button
          type="button"
          onClick={props.onRun}
          disabled={props.running}
          className={`toolbar-icon-btn toolbar-icon-btn-primary ${props.running ? 'pulse' : ''}`}
          title={runTitle}
          aria-label={props.running ? runLabel : 'Run pipeline'}
        >
          <IconPlay />
        </button>
        <span className="toolbar-quick-sep" aria-hidden="true" />
        <button
          type="button"
          className="toolbar-icon-btn"
          onClick={() => {
            props.onOpenAnnotations();
            close();
          }}
          title={props.annotationCount > 0 ? `Binding notes (${props.annotationCount})` : 'Binding notes'}
          aria-label="Binding notes"
        >
          <IconNotes />
          {props.annotationCount > 0 && (
            <span className="toolbar-icon-badge">{props.annotationCount > 99 ? '99+' : props.annotationCount}</span>
          )}
        </button>
        <button
          type="button"
          className="toolbar-icon-btn"
          onClick={() => {
            props.onOpenRenameQueue();
            close();
          }}
          title="Rename queue · tab through symbols"
          aria-label="Rename queue"
        >
          <IconRename />
        </button>
      </div>

      <div className="menubar-right">
        <div className="menubar-meta hidden sm:inline-flex">
          <span className="text-[color:var(--color-bone-4)]">in</span>
          <span className="text-[color:var(--color-bone-2)] tabular-nums">{fmtBytes(props.inputSize)}</span>
          <span className="text-[color:var(--color-bone-4)]">→</span>
          <span className="text-[color:var(--color-bone-4)]">out</span>
          <span className="text-[color:var(--color-matrix)] tabular-nums">{fmtBytes(props.outputSize)}</span>
          {props.fileName && (
            <>
              <span className="text-[color:var(--color-bone-4)]">·</span>
              <span className="text-[color:var(--color-bone-3)] truncate max-w-[min(200px,28vw)]" title={props.fileName}>
                {props.fileName}
              </span>
            </>
          )}
        </div>

        <div className="menubar-actions-end">
          <button
            type="button"
            onClick={() => {
              props.onResetSession();
              close();
            }}
            className="btn-ghost btn"
            title="Clear autosave and reset workbench"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
