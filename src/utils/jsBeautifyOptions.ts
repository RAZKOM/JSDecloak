import type js_beautify from 'js-beautify';

export interface FormatOptions {
  indentSize: number;
  printWidth: number;
}

/**
 * Single source of truth for the js-beautify configuration used by both the
 * pipeline worker (`runFormat`) and the in-editor "Format Document" action.
 * Keeping these in sync is what makes manual reformatting feel like a no-op
 * when the pipeline has already run.
 */
export function buildJsBeautifyOptions(
  { indentSize, printWidth }: FormatOptions,
): js_beautify.JSBeautifyOptions {
  return {
    indent_size: indentSize,
    wrap_line_length: printWidth,
    end_with_newline: true,
    preserve_newlines: true,
    max_preserve_newlines: 2,
    jslint_happy: false,
    space_after_anon_function: false,
    brace_style: 'collapse',
    keep_array_indentation: false,
    break_chained_methods: false,
  };
}
