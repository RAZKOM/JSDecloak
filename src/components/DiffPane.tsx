import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';

interface Props {
  original: string;
  modified: string;
  onMount?: DiffOnMount;
  /** Registered by `registerJsDecloakThemes` (CodeEditor mount). */
  monacoThemeId: string;
}

/**
 * Side-by-side diff for sanity-checking what the deobfuscator did. Read-only
 * by design: the workbench's source of truth is still the input + output text;
 * the diff is a view, not an editor.
 *
 * Model paths are distinct from `jsdecloak-input/*` and `jsdecloak-output/*` so
 * Monaco does not merge tabs/models with the split-pane editors.
 *
 * Theme ids come from `registerJsDecloakThemes`; the app passes the active id
 * so the diff view tracks Settings ▸ Theme.
 */
export function DiffPane({ original, modified, onMount, monacoThemeId }: Props) {
  return (
    <DiffEditor
      original={original}
      modified={modified}
      language="javascript"
      originalModelPath="jsdecloak-diff/original.js"
      modifiedModelPath="jsdecloak-diff/modified.js"
      theme={monacoThemeId}
      onMount={onMount}
      options={{
        readOnly: true,
        renderSideBySide: true,
        ignoreTrimWhitespace: false,
        renderIndicators: true,
        scrollBeyondLastLine: false,
        minimap: { enabled: false },
        fontSize: 12,
        fontFamily: 'var(--font-mono)',
        wordWrap: 'off',
      }}
    />
  );
}
