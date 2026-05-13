import type { editor } from 'monaco-editor';
import type { SymbolInfo } from '../types';

/** Identifier pattern aligned with Monaco's word detection for typical JS identifiers. */
const IDENT_RE = /^[_$A-Za-z][_$0-9A-Za-z]*$/;

export function resolveBindingAtCaret(
  editor: editor.ICodeEditor,
  symbols: readonly SymbolInfo[],
  parseSourceLength: number,
): SymbolInfo | null {
  const model = editor.getModel();
  if (!model || parseSourceLength <= 0) return null;
  if (model.getValueLength() !== parseSourceLength) return null;

  const pos = editor.getPosition();
  if (!pos) return null;
  const offset = model.getOffsetAt(pos);
  const word = model.getWordAtPosition(pos);
  if (!word || !IDENT_RE.test(word.word)) return null;

  const name = word.word;

  const onDecl = symbols.filter(
    (s) =>
      s.name === name &&
      typeof s.definitionStart === 'number' &&
      typeof s.definitionEnd === 'number' &&
      offset >= s.definitionStart &&
      offset < s.definitionEnd,
  );
  if (onDecl.length === 1) return onDecl[0];
  if (onDecl.length > 1) {
    const inner = shallowestScoped(onDecl);
    return inner ?? onDecl[0];
  }

  const byName = symbols.filter((s) => s.name === name);
  if (byName.length === 1) return byName[0];

  return null;
}

function shallowestScoped(syms: SymbolInfo[]): SymbolInfo | null {
  if (syms.length === 0) return null;
  return [...syms].sort((a, b) => b.scopePath.length - a.scopePath.length)[0];
}
