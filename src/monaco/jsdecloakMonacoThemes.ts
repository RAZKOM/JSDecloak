import type { AppTheme } from '../utils/appSettings';

/** Register once; safe to call multiple times (redefines same ids). */
export function registerJsDecloakThemes(monaco: typeof import('monaco-editor')) {
  monaco.editor.defineTheme('jsdecloak-default', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'd8cfbf', background: '100e0b' },
      { token: 'comment', foreground: '5a5147', fontStyle: 'italic' },
      { token: 'string', foreground: '7fd87f' },
      { token: 'number', foreground: 'ff9e3d' },
      { token: 'keyword', foreground: 'b08ad0' },
      { token: 'identifier', foreground: 'd8cfbf' },
      { token: 'type.identifier', foreground: '5fb3c4' },
      { token: 'delimiter', foreground: 'aaa093' },
      { token: 'regexp', foreground: 'd44b3c' },
    ],
    colors: {
      'editor.background': '#100e0b',
      'editor.foreground': '#d8cfbf',
      'editorLineNumber.foreground': '#3a332c',
      'editorLineNumber.activeForeground': '#ff9e3d',
      'editorCursor.foreground': '#ff9e3d',
      'editor.selectionBackground': '#ff9e3d33',
      'editor.lineHighlightBackground': '#1d191680',
      'editorGutter.background': '#0d0c0a',
      'editorIndentGuide.background': '#1d1916',
      'editorIndentGuide.activeBackground': '#3a332c',
      'editor.selectionHighlightBackground': '#ff9e3d22',
      'editor.wordHighlightBackground': '#ff9e3d22',
      'editor.findMatchBackground': '#ff9e3d55',
      'editor.findMatchHighlightBackground': '#ff9e3d22',
      'scrollbarSlider.background': '#28231e80',
      'scrollbarSlider.hoverBackground': '#3a332c80',
      'scrollbarSlider.activeBackground': '#423a32',
    },
  });

  monaco.editor.defineTheme('jsdecloak-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: '18181b', background: 'ffffff' },
      { token: 'comment', foreground: '71717a', fontStyle: 'italic' },
      { token: 'string', foreground: '15803d' },
      { token: 'number', foreground: 'b45309' },
      { token: 'keyword', foreground: '6d28d9' },
      { token: 'identifier', foreground: '18181b' },
      { token: 'type.identifier', foreground: '0369a1' },
      { token: 'delimiter', foreground: '71717a' },
      { token: 'regexp', foreground: 'dc2626' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#18181b',
      'editorLineNumber.foreground': '#a1a1aa',
      'editorLineNumber.activeForeground': '#b45309',
      'editorCursor.foreground': '#b45309',
      'editor.selectionBackground': '#0284c733',
      'editor.lineHighlightBackground': '#f4f4f5',
      'editorGutter.background': '#fafafa',
      'editorIndentGuide.background': '#e4e4e7',
      'editorIndentGuide.activeBackground': '#d4d4d8',
      'editor.selectionHighlightBackground': '#0284c722',
      'editor.wordHighlightBackground': '#eab30833',
      'editor.findMatchBackground': '#b4530955',
      'editor.findMatchHighlightBackground': '#b4530922',
      'scrollbarSlider.background': '#a1a1aa66',
      'scrollbarSlider.hoverBackground': '#71717a66',
      'scrollbarSlider.activeBackground': '#52525b',
    },
  });

  monaco.editor.defineTheme('jsdecloak-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'd4d4d4', background: '1e1e1e' },
      { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
      { token: 'string', foreground: 'ce9178' },
      { token: 'number', foreground: 'b5cea8' },
      { token: 'keyword', foreground: 'c586c0' },
      { token: 'identifier', foreground: 'd4d4d4' },
      { token: 'type.identifier', foreground: 'b8b8b8' },
      { token: 'delimiter', foreground: 'd4d4d4' },
      { token: 'regexp', foreground: 'd16969' },
    ],
    colors: {
      'editor.background': '#1e1e1e',
      'editor.foreground': '#d4d4d4',
      'editorLineNumber.foreground': '#858585',
      'editorLineNumber.activeForeground': '#c6c6c6',
      'editorCursor.foreground': '#d4d4d4',
      'editor.selectionBackground': '#55555599',
      'editor.lineHighlightBackground': '#2a2a2a',
      'editorGutter.background': '#1e1e1e',
      'editorIndentGuide.background': '#404040',
      'editorIndentGuide.activeBackground': '#707070',
      'editor.selectionHighlightBackground': '#303030',
      'editor.wordHighlightBackground': '#303030',
      'editor.findMatchBackground': '#515c6a',
      'editor.findMatchHighlightBackground': '#ea5c0055',
      'scrollbarSlider.background': '#42424280',
      'scrollbarSlider.hoverBackground': '#4f4f4f80',
      'scrollbarSlider.activeBackground': '#5a5a5a',
    },
  });
}

const THEME_MAP: Record<AppTheme, string> = {
  default: 'jsdecloak-default',
  light: 'jsdecloak-light',
  dark: 'jsdecloak-dark',
};

export function monacoThemeIdForAppTheme(theme: AppTheme): string {
  return THEME_MAP[theme];
}
