import { Editor, useMonaco, type BeforeMount, type OnMount } from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import type { IDisposable, editor } from 'monaco-editor';
import { obfuscationScore } from '../utils/obfuscation';
import type { OutputBindingNotesBridgeRef } from '../monaco/outputBindingNoteAction';
import { registerOutputBindingNoteAction } from '../monaco/outputBindingNoteAction';
import { monacoThemeIdForAppTheme, registerJsDecloakThemes } from '../monaco/jsdecloakMonacoThemes';
import type { AppTheme } from '../utils/appSettings';

interface Props {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  highlightObfuscated?: boolean;
  beforeMount?: BeforeMount;
  onMount?: (editor: editor.IStandaloneCodeEditor) => void;
  language?: string;
  path?: string;
  bindingNotesBridge?: () => OutputBindingNotesBridgeRef;
  disableRename?: boolean;
  noteGutterMarks?: ReadonlyArray<{ lineNumber: number; hoverMarkdown: string }>;
  appTheme?: AppTheme;
}

export function CodeEditor({
  value,
  onChange,
  readOnly,
  highlightObfuscated,
  beforeMount,
  onMount,
  language = 'javascript',
  path,
  bindingNotesBridge,
  disableRename = false,
  noteGutterMarks,
  appTheme = 'default',
}: Props) {
  const monaco = useMonaco();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const noteDecorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const bindingNotesDispRef = useRef<IDisposable | null>(null);

  useEffect(() => {
    if (!monaco) return;
    registerJsDecloakThemes(monaco);
  }, [monaco]);

  useEffect(() => {
    if (!monaco || !editorRef.current) return;
    monaco.editor.setTheme(monacoThemeIdForAppTheme(appTheme));
  }, [monaco, appTheme]);

  useEffect(() => {
    if (!monaco || !editorRef.current || !highlightObfuscated) {
      decorationsRef.current?.clear();
      return;
    }
    const model = editorRef.current.getModel();
    if (!model) return;

    const text = model.getValue();
    const tokenRegex = /\b[_$A-Za-z][_$\w]*\b/g;
    const decorations: editor.IModelDeltaDecoration[] = [];
    let match;
    while ((match = tokenRegex.exec(text)) !== null) {
      const name = match[0];
      const score = obfuscationScore(name);
      if (score < 0.7) continue;
      const start = model.getPositionAt(match.index);
      const end = model.getPositionAt(match.index + name.length);
      const renameHint = disableRename
        ? 'Rename from the output pane after running the pipeline; scope-aware rename applies there only.'
        : 'F2 to rename; propagates through scope bindings.';
      decorations.push({
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        options: {
          inlineClassName: 'obf-ident',
          hoverMessage: { value: `obfuscated identifier · score ${(score * 100).toFixed(0)}%\n\n${renameHint}` },
        },
      });
    }

    if (!decorationsRef.current) {
      decorationsRef.current = editorRef.current.createDecorationsCollection(decorations);
    } else {
      decorationsRef.current.set(decorations);
    }
  }, [value, highlightObfuscated, monaco, disableRename]);

  const marksLen = noteGutterMarks?.length ?? 0;

  useEffect(() => {
    if (!monaco || !editorRef.current) return;
    const ed = editorRef.current;
    const model = ed.getModel();
    if (!model) return;

    const marks = noteGutterMarks ?? [];
    const lineCount = model.getLineCount();
    const decos: editor.IModelDeltaDecoration[] = [];
    for (const m of marks) {
      if (m.lineNumber < 1 || m.lineNumber > lineCount) continue;
      decos.push({
        range: new monaco.Range(m.lineNumber, 1, m.lineNumber, 1),
        options: {
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          glyphMarginClassName: 'jsdecloak-note-glyph',
          glyphMargin: {
            position: monaco.editor.GlyphMarginLane.Center,
          },
          glyphMarginHoverMessage: { value: m.hoverMarkdown, isTrusted: true },
          overviewRuler: {
            color: '#ff9e3d88',
            position: monaco.editor.OverviewRulerLane.Left,
          },
        },
      });
    }

    if (!noteDecorationsRef.current) {
      noteDecorationsRef.current = ed.createDecorationsCollection(decos);
    } else {
      noteDecorationsRef.current.set(decos);
    }
  }, [noteGutterMarks, value, monaco]);

  const handleMount: OnMount = (ed, mon) => {
    editorRef.current = ed;
    registerJsDecloakThemes(mon);
    mon.editor.setTheme(monacoThemeIdForAppTheme(appTheme));
    const hiddenMenuIds = ['editor.action.changeAll'];
    if (disableRename) hiddenMenuIds.push('editor.action.rename');
    hideContextMenuActions(ed, hiddenMenuIds);

    const mountDisposables: IDisposable[] = [];
    if (disableRename) {
      mountDisposables.push(
        ed.onKeyDown((e) => {
          if (e.keyCode === mon.KeyCode.F2) {
            e.preventDefault();
            e.stopPropagation();
          }
        }),
      );
    }
    ed.onDidDispose(() => {
      for (const d of mountDisposables) d.dispose();
    });
    bindingNotesDispRef.current?.dispose();
    bindingNotesDispRef.current =
      bindingNotesBridge != null ? registerOutputBindingNoteAction(ed, bindingNotesBridge) : null;
    onMount?.(ed);
  };

  useEffect(
    () => () => {
      bindingNotesDispRef.current?.dispose();
      bindingNotesDispRef.current = null;
    },
    [],
  );

  return (
    <Editor
      value={value}
      path={path}
      language={language}
      theme={monacoThemeIdForAppTheme(appTheme)}
      beforeMount={beforeMount}
      onChange={(v) => onChange?.(v ?? '')}
      onMount={handleMount}
      options={{
        readOnly,
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        fontLigatures: false,
        lineNumbers: 'on',
        renderWhitespace: 'selection',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        smoothScrolling: false,
        cursorBlinking: 'solid',
        cursorStyle: 'block',
        roundedSelection: false,
        padding: { top: 12, bottom: 12 },
        glyphMargin: marksLen > 0,
        folding: true,
        showFoldingControls: 'mouseover',
        renderLineHighlight: 'gutter',
        guides: { indentation: true, highlightActiveIndentation: false },
        wordWrap: 'off',
        bracketPairColorization: { enabled: false },
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      }}
    />
  );
}

function hideContextMenuActions(
  ed: editor.IStandaloneCodeEditor,
  removableIds: string[],
): void {
  const removable = new Set(removableIds);
  try {
    const contribution = ed.getContribution('editor.contrib.contextmenu') as
      | (editor.IEditorContribution & {
          _getMenuActions?: (...args: unknown[]) => Array<{ id?: string }>;
        })
      | null;
    const original = contribution?._getMenuActions;
    if (!contribution || typeof original !== 'function') return;
    const bound = original.bind(contribution);
    contribution._getMenuActions = (...args: unknown[]) =>
      bound(...args).filter((item) => !item?.id || !removable.has(item.id));
  } catch {
  }
}
