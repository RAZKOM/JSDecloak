// Minimal os shim for browser. Most calls are informational and we can return
// neutral defaults without breaking anything.

export const EOL = '\n';
export const platform = () => 'browser';
export const arch = () => 'wasm32';
export const type = () => 'Browser';
export const release = () => '1.0.0';
export const cpus = () => [{ model: 'browser', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }];
export const totalmem = () => 0;
export const freemem = () => 0;
export const homedir = () => '/';
export const tmpdir = () => '/tmp';
export const hostname = () => 'browser';
export const userInfo = () => ({ username: 'browser', uid: 0, gid: 0, homedir: '/', shell: null });
export const networkInterfaces = () => ({});
export const constants = { signals: {}, errno: {}, priority: {} };
export const endianness = () => 'LE';

export default {
  EOL, platform, arch, type, release, cpus, totalmem, freemem,
  homedir, tmpdir, hostname, userInfo, networkInterfaces, constants, endianness,
};
