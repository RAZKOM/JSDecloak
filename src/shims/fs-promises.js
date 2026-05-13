// fs/promises shim - delegates to the main fs shim
import * as fs from './fs.js';

export const readFile = fs.readFile;
export const writeFile = fs.writeFile;
export const mkdir = fs.mkdir;
export const readdir = fs.readdir;
export const stat = fs.stat;
export const lstat = fs.lstat;
export const unlink = fs.unlink;
export const rm = fs.rm;
export const rmdir = fs.rmdir;
export const access = fs.access;
export const realpath = fs.realpath;

export default {
  readFile, writeFile, mkdir, readdir, stat, lstat, unlink, rm, rmdir, access, realpath,
};
