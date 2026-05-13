const BASE64_RE = /^[A-Za-z0-9+/=\s]+$/;
const HEX_RE = /^(?:0x)?[0-9a-fA-F\s]+$/;

export interface DecodeAttempt {
  ok: boolean;
  value?: string;
  error?: string;
}

export function tryBase64(input: string): DecodeAttempt {
  const stripped = input.replace(/\s+/g, '');
  if (stripped.length < 4 || stripped.length % 4 !== 0) {
    return { ok: false, error: 'length not a multiple of 4' };
  }
  if (!BASE64_RE.test(stripped)) {
    return { ok: false, error: 'non-base64 characters' };
  }
  try {
    const bytes = atob(stripped);
    return { ok: true, value: bytes };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function tryHex(input: string): DecodeAttempt {
  const stripped = input.replace(/\s+/g, '').replace(/^0x/i, '');
  if (stripped.length === 0 || stripped.length % 2 !== 0) {
    return { ok: false, error: 'odd hex length' };
  }
  if (!HEX_RE.test(input)) {
    return { ok: false, error: 'non-hex characters' };
  }
  try {
    let out = '';
    for (let i = 0; i < stripped.length; i += 2) {
      out += String.fromCharCode(parseInt(stripped.slice(i, i + 2), 16));
    }
    return { ok: true, value: out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function tryUrlDecode(input: string): DecodeAttempt {
  if (!input.includes('%')) {
    return { ok: false, error: 'no %xx sequences' };
  }
  try {
    return { ok: true, value: decodeURIComponent(input) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function possibleDecodings(input: string): {
  base64: boolean;
  hex: boolean;
  url: boolean;
} {
  const stripped = input.replace(/\s+/g, '');
  return {
    base64: stripped.length >= 4 && stripped.length % 4 === 0 && BASE64_RE.test(stripped),
    hex: stripped.length >= 2 && stripped.length % 2 === 0 && HEX_RE.test(input),
    url: input.includes('%'),
  };
}
