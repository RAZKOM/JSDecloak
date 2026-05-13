// path-browserify is good but it doesn't export the .posix sub-object the same
// way Node's path does. Webcrack does `import { posix } from 'path'` and then
// destructures `dirname` from posix - which crashes if posix is undefined.
// This shim wraps path-browserify and adds the missing exports.

import pathBrowserify from 'path-browserify';

const posix = {
  sep: '/',
  delimiter: ':',
  basename: pathBrowserify.basename,
  dirname: pathBrowserify.dirname,
  extname: pathBrowserify.extname,
  format: pathBrowserify.format,
  isAbsolute: pathBrowserify.isAbsolute,
  join: pathBrowserify.join,
  normalize: pathBrowserify.normalize,
  parse: pathBrowserify.parse,
  relative: pathBrowserify.relative,
  resolve: pathBrowserify.resolve,
  toNamespacedPath: (p) => p,
};

const win32 = {
  ...posix,
  sep: '\\',
  delimiter: ';',
};

posix.posix = posix;
posix.win32 = win32;
win32.posix = posix;
win32.win32 = win32;

export const sep = '/';
export const delimiter = ':';
export const basename = pathBrowserify.basename;
export const dirname = pathBrowserify.dirname;
export const extname = pathBrowserify.extname;
export const format = pathBrowserify.format;
export const isAbsolute = pathBrowserify.isAbsolute;
export const join = pathBrowserify.join;
export const normalize = pathBrowserify.normalize;
export const parse = pathBrowserify.parse;
export const relative = pathBrowserify.relative;
export const resolve = pathBrowserify.resolve;
export const toNamespacedPath = (p) => p;
export { posix, win32 };

export default {
  sep, delimiter, basename, dirname, extname, format, isAbsolute, join,
  normalize, parse, relative, resolve, toNamespacedPath, posix, win32,
};
