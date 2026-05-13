import type { IDisposable } from 'monaco-editor';
import jsBeautify from 'js-beautify';
import { buildJsBeautifyOptions, type FormatOptions } from '../utils/jsBeautifyOptions';

type MonacoModule = typeof import('monaco-editor');

export interface FormatBridge {
  getFormatOptions: () => FormatOptions;
}

let formatDisposable: IDisposable | null = null;
let defaultJsFormatterDisabled = false;

/**
 * Replaces Monaco's built-in JavaScript formatter (which comes from the bundled
 * TypeScript worker and uses its own style heuristics) with one that runs the
 * exact same `js-beautify` pass as the pipeline. This makes the editor's
 * "Format Document" command produce output identical to the pipeline's
 * format step, instead of fighting it.
 *
 * The `getBridge` indirection lets us read the latest indent / print-width
 * settings from React state without re-registering the provider on every change.
 */
export function registerJsFormatProvider(
  monaco: MonacoModule,
  getBridge: () => FormatBridge,
): IDisposable {
  formatDisposable?.dispose();
  formatDisposable = null;

  if (!defaultJsFormatterDisabled) {
    try {
      const jsDefaults = monaco.typescript.javascriptDefaults;
      const current = jsDefaults.modeConfiguration;
      jsDefaults.setModeConfiguration({
        ...current,
        documentRangeFormattingEdits: false,
        onTypeFormattingEdits: false,
      });
      defaultJsFormatterDisabled = true;
    } catch {
      // monaco-editor surface may differ across versions; if it does, our
      // provider will simply compete with the default formatter.
    }
  }

  formatDisposable = monaco.languages.registerDocumentFormattingEditProvider(
    'javascript',
    {
      displayName: 'jsdecloak (js-beautify)',
      provideDocumentFormattingEdits(model) {
        const opts = getBridge().getFormatOptions();
        try {
          const formatted = jsBeautify.js_beautify(
            model.getValue(),
            buildJsBeautifyOptions(opts),
          );
          return [
            {
              range: model.getFullModelRange(),
              text: formatted,
            },
          ];
        } catch {
          return [];
        }
      },
    },
  );

  return formatDisposable;
}

export function disposeJsFormatProvider(): void {
  formatDisposable?.dispose();
  formatDisposable = null;
}
