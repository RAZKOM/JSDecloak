const HEX_PATTERN = /^_0x[a-f0-9]{3,}$/i;
const UNDERSCORE_PATTERN = /^_{2,}[a-zA-Z0-9]*$/;
const SHORT_PATTERN = /^[a-zA-Z]$/;
const DOLLAR_HEX = /^\$[a-f0-9]{4,}$/i;

/** Hand-written 1-3 char ids (lowercase); avoids ref-boost false positives for common abbreviations. */
const HAND_WRITTEN_SHORT = new Set([
  'id', 'fn', 'cb', 'to', 'el', 'ev', 'at', 'on', 'as', 'is', 'or', 'no', 'ok',
  'err', 'val', 'key', 'idx', 'ref', 'tag', 'url', 'src', 'api', 'req', 'res',
  'ctx', 'obj', 'arr', 'str', 'num', 'len', 'sum', 'min', 'max', 'row', 'col',
  'dom', 'evt', 'tmp', 'old', 'new', 'sub', 'add', 'del', 'get', 'set', 'has',
  'run', 'use', 'tab', 'buf', 'end', 'pos', 'dir', 'env', 'uid',
]);

/**
 * Returns a confidence score 0-1 that an identifier is auto-generated.
 * Short single-char names are only flagged when used in non-trivial scopes,
 * but we cannot judge scope from the name alone, so we return a soft signal
 * for those and let the caller weight it.
 */
export function obfuscationScore(name: string): number {
  if (HEX_PATTERN.test(name)) return 1.0;
  if (DOLLAR_HEX.test(name)) return 0.95;
  if (UNDERSCORE_PATTERN.test(name)) return 0.7;
  if (SHORT_PATTERN.test(name)) return 0.3; // suggestive but ambiguous
  // common auto names from terser/uglify: a..z, aa..zz, _a..
  if (
    /^[a-z]{1,3}$/.test(name) &&
    name !== 'i' &&
    name !== 'j' &&
    name !== 'k' &&
    !HAND_WRITTEN_SHORT.has(name)
  ) {
    return 0.2;
  }
  return 0;
}

export function isObfuscated(name: string, refCount = 0): boolean {
  const score = obfuscationScore(name);
  if (score >= 0.7) return true;
  // Short names with many references in a meaningful scope are suspicious
  if (score >= 0.2 && refCount >= 3) return true;
  return false;
}
