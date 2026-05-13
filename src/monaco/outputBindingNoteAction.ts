import type { editor, IDisposable } from 'monaco-editor';
import type { SymbolInfo } from '../types';
import { resolveBindingAtCaret } from '../utils/symbolLookup';

export interface OutputBindingNotesBridgeRef {
  getSymbols: () => readonly SymbolInfo[];
  getIndexedParseLength: () => number | null;
  refreshIndexedSymbols: () => Promise<{ symbols: readonly SymbolInfo[]; parseSourceLength: number } | null>;
  onOpenBindingNotes: (symbol: SymbolInfo) => void;
  onUnresolvedBinding: (hint: string) => void;
}

export function registerOutputBindingNoteAction(
  editor: editor.IStandaloneCodeEditor,
  bridge: () => OutputBindingNotesBridgeRef,
): IDisposable {
  return editor.addAction({
    id: 'jsdecloak.output.bindingNote',
    label: 'Binding note…',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 10,
    run(ed) {
      void runBindingNoteFlow(ed, bridge);
    },
  });
}

async function runBindingNoteFlow(
  ed: editor.ICodeEditor,
  bridge: () => OutputBindingNotesBridgeRef,
): Promise<void> {
  const warn = (hint: string) => bridge().onUnresolvedBinding(hint);

  try {
    let model = ed.getModel();
    let modelLen = model?.getValueLength() ?? 0;
    if (modelLen < 1) {
      warn('There’s no cleaned code yet. Click **Run** on the toolbar (⌘↵ or Ctrl+Enter).');
      return;
    }

    let symbols = bridge().getSymbols();
    const indexedLen = bridge().getIndexedParseLength();

    if (indexedLen != null && indexedLen !== modelLen) {
      const refreshed = await bridge().refreshIndexedSymbols();
      if (!refreshed) {
        warn(
          'Couldn’t scan variables in this text. Fix any syntax errors, or click **Run** to regenerate the output.',
        );
        return;
      }
      symbols = refreshed.symbols;
      model = ed.getModel();
      modelLen = model?.getValueLength() ?? 0;
      if (refreshed.parseSourceLength !== modelLen) {
        warn('The text changed while scanning. Try **Binding note…** again.');
        return;
      }
    }

    if (!symbols.length) {
      warn('No variables were found. Click **Run** (⌘↵) so the cleaned code is parsed first.');
      return;
    }

    model = ed.getModel();
    modelLen = model?.getValueLength() ?? 0;
    if (modelLen < 1) return;

    const sym = resolveBindingAtCaret(ed, symbols, modelLen);
    if (!sym) {
      warn(
        'Put the text cursor on that variable’s **declaration** (where it’s created), or use a name that appears only once.',
      );
      return;
    }

    bridge().onOpenBindingNotes(sym);
  } catch (e) {
    console.error('[binding note]', e);
    warn(e instanceof Error ? e.message : 'Binding note failed.');
  }
}
