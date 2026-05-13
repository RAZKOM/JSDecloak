// Probe what's actually exported and whether they run in pure Node ESM context
const SAMPLE = `var _0x4f2a=['log'];function _0xa1b2(_0xc3d4){console[_0x4f2a[0]](_0xc3d4);}_0xa1b2('hi');`;

console.log('--- Wakaru ---');
try {
  const w = await import('@wakaru/unminify');
  console.log('exports:', Object.keys(w));
  if (typeof w.runDefaultTransformation === 'function') {
    const r = await w.runDefaultTransformation(SAMPLE, {});
    console.log('result keys:', Object.keys(r));
    console.log('output preview:', String(r.code).slice(0, 200));
  }
} catch (e) {
  console.log('FAIL:', e.message);
}

console.log('\n--- Synchrony ---');
try {
  const s = await import('deobfuscator');
  console.log('exports:', Object.keys(s));
  if (s.Deobfuscator) {
    const d = new s.Deobfuscator();
    const out = await d.deobfuscateSource(SAMPLE);
    console.log('output preview:', String(out).slice(0, 200));
  }
} catch (e) {
  console.log('FAIL:', e.message);
}
