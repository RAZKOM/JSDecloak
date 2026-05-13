// Browser stub for node:fs / fs. The deobfuscation libs only call these for
// disk I/O (writing bundle output) which we never trigger from the worker.
// If a code path ever does call one of these, it'll throw a clear error.

function notSupported(name) {
  return () => {
    throw new Error(`fs.${name} is not supported in the browser. The deobfuscator tried to write to disk; use the in-memory output instead.`);
  };
}

export const readFile = notSupported('readFile');
export const writeFile = notSupported('writeFile');
export const mkdir = notSupported('mkdir');
export const readdir = notSupported('readdir');
export const stat = notSupported('stat');
export const lstat = notSupported('lstat');
export const unlink = notSupported('unlink');
export const rm = notSupported('rm');
export const rmdir = notSupported('rmdir');
export const access = notSupported('access');
export const realpath = notSupported('realpath');
export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };
export const promises = {
  readFile, writeFile, mkdir, readdir, stat, lstat, unlink, rm, rmdir, access, realpath,
};
export const existsSync = () => false;
export const readFileSync = notSupported('readFileSync');
export const writeFileSync = notSupported('writeFileSync');
export const mkdirSync = notSupported('mkdirSync');
export const statSync = notSupported('statSync');

export default {
  readFile, writeFile, mkdir, readdir, stat, lstat, unlink, rm, rmdir, access, realpath,
  constants, promises, existsSync, readFileSync, writeFileSync, mkdirSync, statSync,
};
