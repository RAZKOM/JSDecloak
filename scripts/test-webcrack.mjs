import { webcrack } from 'webcrack';

const SAMPLE = `var _0x4f2a=['log','from\\x20wakaru','init','random'];(function(_0x1a2b,_0x3c4d){var _0x5e6f=function(_0x7g8h){while(--_0x7g8h){_0x1a2b['push'](_0x1a2b['shift']());}};_0x5e6f(++_0x3c4d);}(_0x4f2a,0x1f3));var _0x9i0j=function(_0xkl1m,_0xno2p){_0xkl1m=_0xkl1m-0x0;var _0xqr3s=_0x4f2a[_0xkl1m];return _0xqr3s;};function _0xa1b2(_0xc3d4){var _0xe5f6=Math[_0x9i0j('0x3')]();console[_0x9i0j('0x0')](_0x9i0j('0x2'),_0xc3d4,_0xe5f6);return _0xe5f6*_0xc3d4;}_0xa1b2(0xa);`;

console.log(`input: ${SAMPLE.length} chars\n`);

const result = await webcrack(SAMPLE, {
  jsx: false,
  unpack: true,
  unminify: true,
  deobfuscate: true,
  mangle: false,
});

console.log('===== WEBCRACK OUTPUT =====');
console.log(result.code);
console.log('===========================');
console.log(`\noutput: ${result.code.length} chars`);
console.log(`bundle: ${result.bundle?.type ?? 'none'}`);
