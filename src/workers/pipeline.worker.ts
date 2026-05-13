/// <reference lib="webworker" />

import type { PipelineConfig, PipelineResult, LogEntry, SymbolInfo, ParseSummary, OutlineNode, StringLiteralEntry } from '../types';
import { parse } from '@babel/parser';
import type { NodePath } from '@babel/traverse';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import { serializeAstToSlim } from '../utils/astSlimSerialize';
import { isObfuscated } from '../utils/obfuscation';
import { buildJsBeautifyOptions } from '../utils/jsBeautifyOptions';
import { scopePathOf } from '../utils/scopePath';
import { batchRenameBindings } from '../utils/rename';
import jsBeautify from 'js-beautify';

// Babel's CJS interop: when bundled to ESM, the default export is wrapped.
const traverse = (_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse;

declare const self: DedicatedWorkerGlobalScope;

interface PipelineMessage {
  type: 'run';
  input: string;
  config: PipelineConfig;
  jobId: string;
}

/**
 * Out-of-band job: apply a batch of renames against `input`, then re-parse to
 * produce a fresh summary. Heavy work (parse + many renames + generate +
 * parse) happens in the worker so the UI stays responsive even on 700-op
 * batches.
 */
interface RenameBatchMessage {
  type: 'renameBatch';
  jobId: string;
  input: string;
  config: PipelineConfig;
  ops: Array<{
    from: string;
    to: string;
    scopePath?: string;
    position?: { line: number; column: number };
  }>;
}

interface ProgressMessage {
  type: 'progress';
  jobId: string;
  step: string;
  percent: number;
}

interface DoneMessage {
  type: 'done';
  jobId: string;
  result: PipelineResult;
}

interface RenameBatchDoneMessage {
  type: 'renameBatchDone';
  jobId: string;
  code: string;
  applied: Array<{ from: string; to: string; scopePath: string; refs: number }>;
  skipped: Array<{ from: string; to: string; reason: string }>;
  summary: ParseSummary | null;
  log: LogEntry[];
}

interface ErrorMessage {
  type: 'error';
  jobId: string;
  error: string;
}

type CjsRequire = (specifier: string) => unknown;
type GlobalWithRequire = typeof globalThis & { require?: CjsRequire };

function createAssertShim() {
  const assertFn = ((value: unknown, message?: string) => {
    if (!value) throw new Error(message ?? 'Assertion failed');
  }) as ((value: unknown, message?: string) => void) & {
    ok: (value: unknown, message?: string) => void;
    equal: (a: unknown, b: unknown, message?: string) => void;
    strictEqual: (a: unknown, b: unknown, message?: string) => void;
    notEqual: (a: unknown, b: unknown, message?: string) => void;
    deepEqual: (a: unknown, b: unknown, message?: string) => void;
    deepStrictEqual: (a: unknown, b: unknown, message?: string) => void;
    notDeepEqual: (a: unknown, b: unknown, message?: string) => void;
    notDeepStrictEqual: (a: unknown, b: unknown, message?: string) => void;
    fail: (message?: string) => never;
  };

  const jsonEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  assertFn.ok = assertFn;
  assertFn.equal = (a, b, message) => {
    if (a != b) throw new Error(message ?? `${String(a)} != ${String(b)}`);
  };
  assertFn.strictEqual = (a, b, message) => {
    if (a !== b) throw new Error(message ?? `${String(a)} !== ${String(b)}`);
  };
  assertFn.notEqual = (a, b, message) => {
    if (a == b) throw new Error(message ?? `${String(a)} == ${String(b)}`);
  };
  assertFn.deepEqual = (a, b, message) => {
    if (!jsonEq(a, b)) throw new Error(message ?? 'deepEqual failed');
  };
  assertFn.deepStrictEqual = (a, b, message) => {
    if (!jsonEq(a, b)) throw new Error(message ?? 'deepStrictEqual failed');
  };
  assertFn.notDeepEqual = (a, b, message) => {
    if (jsonEq(a, b)) throw new Error(message ?? 'notDeepEqual failed');
  };
  assertFn.notDeepStrictEqual = (a, b, message) => {
    if (jsonEq(a, b)) throw new Error(message ?? 'notDeepStrictEqual failed');
  };
  assertFn.fail = (message) => {
    throw new Error(message ?? 'fail');
  };
  return assertFn;
}

function createFsShim() {
  const unsupported = (name: string) => () => {
    throw new Error(`fs.${name} is not supported in browser workers`);
  };
  return {
    constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 },
    promises: {
      readFile: unsupported('readFile'),
      writeFile: unsupported('writeFile'),
      mkdir: unsupported('mkdir'),
      stat: unsupported('stat'),
      readdir: unsupported('readdir'),
      unlink: unsupported('unlink'),
      rm: unsupported('rm'),
    },
    existsSync: () => false,
    readFileSync: unsupported('readFileSync'),
    writeFileSync: unsupported('writeFileSync'),
    readFile: unsupported('readFile'),
    writeFile: unsupported('writeFile'),
    mkdir: unsupported('mkdir'),
    stat: unsupported('stat'),
    readdir: unsupported('readdir'),
    unlink: unsupported('unlink'),
    rm: unsupported('rm'),
  };
}

function createOsShim() {
  return {
    EOL: '\n',
    platform: () => 'browser',
    arch: () => 'wasm32',
    type: () => 'Browser',
    release: () => '1.0.0',
    cpus: () => [],
    totalmem: () => 0,
    freemem: () => 0,
    homedir: () => '/',
    tmpdir: () => '/tmp',
    hostname: () => 'browser',
  };
}

function installAssertRequireShim(entries: LogEntry[]) {
  const g = globalThis as GlobalWithRequire;
  if (typeof g.require === 'function') return;
  const assertShim = createAssertShim();
  const fsShim = createFsShim();
  const osShim = createOsShim();

  const requireShim: CjsRequire = (specifier) => {
    if (specifier === 'assert' || specifier === 'node:assert' || specifier === 'assert/strict') {
      return assertShim;
    }
    if (specifier === 'fs' || specifier === 'node:fs') {
      return fsShim;
    }
    if (specifier === 'os' || specifier === 'node:os') {
      return osShim;
    }
    throw new Error(`Unsupported CJS require("${specifier}") in worker runtime`);
  };

  g.require = requireShim;
  log(entries, 'info', 'wakaru', 'installed worker require shim for assert/fs/os');
}

function createWebcrackWorkerSandbox() {
  return async (code: string): Promise<unknown> => {
    // Evaluate decoder snippets in an isolated callable scope for browser workers.
    const fn = new Function(
      `"use strict"; return (${code});`,
    ) as () => unknown;
    return fn();
  };
}

function log(entries: LogEntry[], level: LogEntry['level'], source: string, message: string) {
  entries.push({ ts: Date.now(), level, source, message });
}

function postProgress(jobId: string, step: string, percent: number) {
  const msg: ProgressMessage = { type: 'progress', jobId, step, percent };
  self.postMessage(msg);
}

async function runFormat(code: string, config: PipelineConfig, entries: LogEntry[]): Promise<string> {
  try {
    const out = jsBeautify.js_beautify(
      code,
      buildJsBeautifyOptions({ indentSize: config.indentSize, printWidth: config.printWidth }),
    );
    log(entries, 'ok', 'format', `js-beautify: ${code.length} → ${out.length} chars`);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(entries, 'warn', 'format', `formatter failed, passing through: ${msg}`);
    return code;
  }
}

async function runWebcrack(code: string, entries: LogEntry[]): Promise<string> {
  try {
    const wc = await import('webcrack');
    const result = await wc.webcrack(code, {
      jsx: false,
      unpack: true,
      unminify: true,
      deobfuscate: true,
      mangle: false,
      sandbox: createWebcrackWorkerSandbox(),
    });
    if (result.bundle) {
      log(entries, 'info', 'webcrack', `detected bundle: ${result.bundle.type}`);
    }
    log(entries, 'ok', 'webcrack', `unpack + deobfuscate complete`);
    return result.code;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(entries, 'err', 'webcrack', `webcrack failed: ${msg}`);
    throw e;
  }
}

async function runWakaru(code: string, config: PipelineConfig, entries: LogEntry[]): Promise<string> {
  try {
    installAssertRequireShim(entries);
    // Wakaru's package API changed across versions (transformation vs transformationRules).
    const wakaru = await import('@wakaru/unminify');

    const api = wakaru as unknown as {
      runDefaultTransformation?: (code: string, opts?: object) => Promise<{ code: string }> | { code: string };
      runDefaultTransformationRules?: (
        fileInfo: { source: string; path: string },
        params?: object
      ) => Promise<{ code: string }> | { code: string };
      default?: unknown;
    };

    if (typeof api.runDefaultTransformation === 'function') {
      const res = await api.runDefaultTransformation(code, {
        aggressive: config.wakaruAggressive,
      });
      log(entries, 'info', 'wakaru', 'using runDefaultTransformation API');
      log(entries, 'warn', 'wakaru', 'may restructure control flow and rename identifiers; output can differ structurally from original');
      log(entries, 'ok', 'wakaru', 'transformation complete');
      return res.code;
    }

    if (typeof api.runDefaultTransformationRules === 'function') {
      const res = await api.runDefaultTransformationRules(
        { source: code, path: '/input.js' },
        { aggressive: config.wakaruAggressive },
      );
      log(entries, 'info', 'wakaru', 'using runDefaultTransformationRules API');
      log(entries, 'warn', 'wakaru', 'may restructure control flow and rename identifiers; output can differ structurally from original');
      log(entries, 'ok', 'wakaru', 'transformation complete');
      return res.code;
    }

    log(entries, 'err', 'wakaru', 'wakaru API not found in build (expected runDefaultTransformation or runDefaultTransformationRules export)');
    throw new Error('Wakaru is unavailable in this browser build. Falling back.');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(entries, 'err', 'wakaru', `wakaru failed: ${msg}. Try Webcrack or Synchrony.`);
    throw e;
  }
}

async function runSynchrony(code: string, entries: LogEntry[]): Promise<string> {
  try {
    const synch = await import('deobfuscator');
    const api = synch as unknown as {
      Deobfuscator?: new () => { deobfuscateSource: (code: string) => Promise<string> };
      default?: unknown;
    };
    if (api.Deobfuscator) {
      const d = new api.Deobfuscator();
      const out = await d.deobfuscateSource(code);
      log(entries, 'ok', 'synchrony', 'obfuscator.io patterns processed');
      return out;
    }
    log(entries, 'err', 'synchrony', 'synchrony API not available');
    throw new Error('Synchrony unavailable in browser build.');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(entries, 'err', 'synchrony', `synchrony failed: ${msg}`);
    throw e;
  }
}

async function runDeobfuscate(code: string, config: PipelineConfig, entries: LogEntry[]): Promise<string> {
  if (config.engine === 'none') {
    log(entries, 'info', 'deobfuscate', 'engine = none, skipping');
    return code;
  }
  log(entries, 'info', 'deobfuscate', `engine = ${config.engine}`);
  switch (config.engine) {
    case 'webcrack':
      return runWebcrack(code, entries);
    case 'wakaru':
      try {
        return await runWakaru(code, config, entries);
      } catch {
        log(entries, 'warn', 'deobfuscate', 'wakaru failed, trying webcrack as fallback');
        return runWebcrack(code, entries);
      }
    case 'synchrony':
      try {
        return await runSynchrony(code, entries);
      } catch {
        log(entries, 'warn', 'deobfuscate', 'synchrony failed, trying webcrack as fallback');
        return runWebcrack(code, entries);
      }
    default:
      return code;
  }
}

type BabelLoc = {
  start: { line: number; column: number };
  end: { line: number; column: number };
};

/** UTF-16 length beyond which slim AST serialization is skipped (worker memory / UI latency). */
const AST_TREE_MAX_SOURCE_CHARS = 400_000;
/** All-or-nothing node budget for slim tree payload. */
const AST_TREE_MAX_NODES = 45_000;
/** Max string-literal entries surfaced to the UI; very high counts blow message size. */
const STRING_ENTRY_LIMIT = 2_000;

function spanFromNode(
  node: { start?: number | null; end?: number | null; loc?: BabelLoc | null } | null | undefined,
): Pick<
  SymbolInfo,
  | 'definitionStart'
  | 'definitionEnd'
  | 'definitionLine'
  | 'rangeStartLineNumber'
  | 'rangeStartColumn'
  | 'rangeEndLineNumber'
  | 'rangeEndColumn'
> | undefined {
  if (!node || node.start == null || node.end == null) return undefined;
  const line = node.loc?.start.line;
  const loc = node.loc;
  const rangeFromLoc =
    loc?.start != null && loc.end != null
      ? {
          rangeStartLineNumber: loc.start.line,
          rangeStartColumn: loc.start.column + 1,
          rangeEndLineNumber: loc.end.line,
          rangeEndColumn: loc.end.column + 1,
        }
      : {};
  return {
    definitionStart: node.start,
    definitionEnd: node.end,
    ...(line != null ? { definitionLine: line } : {}),
    ...rangeFromLoc,
  };
}

/** Stable table key: one lexical binding per (name, owning scope uid). */
function symbolTableKey(name: string, scopeUid: number): string {
  return `${name}:${scopeUid}`;
}

function addClassSyntheticSymbols(
  classPath: NodePath<t.ClassDeclaration | t.ClassExpression>,
  symbolsMap: Map<string, SymbolInfo>,
): void {
  const id = classPath.node.id;
  if (t.isIdentifier(id)) {
    const name = id.name;
    let binding = classPath.scope.getBinding(name);
    if (!binding) binding = classPath.scope.parent?.getBinding(name) ?? undefined;
    const span = spanFromNode(id);
    if (span && binding) {
      symbolsMap.set(`cl:${symbolTableKey(name, binding.scope.uid)}`, {
        name,
        refCount: binding.references,
        isObfuscated: false,
        scope: `scope@${binding.scope.uid}`,
        scopePath: scopePathOf(binding.scope),
        kind: 'class',
        ...span,
      });
    }
  }

  const methodNames = new Set<string>();
  classPath.get('body').traverse({
    ClassMethod(m) {
      const k = m.node.key;
      if (t.isIdentifier(k) && !m.node.computed) methodNames.add(k.name);
    },
  });

  classPath.get('body').traverse({
    ClassMethod(methodPath) {
      const k = methodPath.node.key;
      if (!t.isIdentifier(k) || methodPath.node.computed) return;
      const name = k.name;
      let thisHits = 0;
      classPath.get('body').traverse({
        MemberExpression(mp) {
          if (mp.node.computed) return;
          const pr = mp.node.property;
          if (!t.isIdentifier(pr) || pr.name !== name) return;
          if (!t.isThisExpression(mp.node.object)) return;
          thisHits++;
        },
      });
      const span = spanFromNode(k);
      if (!span) return;
      symbolsMap.set(`cm:${symbolTableKey(name, methodPath.scope.uid)}`, {
        name,
        refCount: thisHits,
        isObfuscated: false,
        scope: `method@${methodPath.scope.uid}`,
        scopePath: scopePathOf(methodPath.scope),
        kind: 'method',
        ...span,
      });
    },
  });

  const propAgg = new Map<string, { count: number; ident: t.Identifier }>();
  classPath.get('body').traverse({
    MemberExpression(mp) {
      if (mp.node.computed) return;
      const pr = mp.node.property;
      if (!t.isIdentifier(pr)) return;
      if (!t.isThisExpression(mp.node.object)) return;
      if (methodNames.has(pr.name)) return;
      const cur = propAgg.get(pr.name);
      if (cur) cur.count++;
      else propAgg.set(pr.name, { count: 1, ident: pr });
    },
  });

  for (const [name, { count, ident }] of propAgg) {
    const span = spanFromNode(ident);
    if (!span) continue;
    symbolsMap.set(`ip:${symbolTableKey(name, classPath.scope.uid)}`, {
      name,
      refCount: count,
      isObfuscated: false,
      scope: `class@${classPath.scope.uid}`,
      scopePath: scopePathOf(classPath.scope),
      kind: 'instanceProp',
      ...span,
    });
  }
}

function runParse(code: string, config: PipelineConfig, entries: LogEntry[]): ParseSummary {
  const summary: ParseSummary = {
    ok: false,
    variableCount: 0,
    stringLiteralCount: 0,
    functionCount: 0,
    obfuscatedCount: 0,
    symbols: [],
  };

  let ast;
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
      errorRecovery: true,
      plugins: [
        ...(config.parseJsx ? ['jsx' as const] : []),
        ...(config.parseTypescript ? ['typescript' as const] : []),
      ],
    });
  } catch (e) {
    summary.error = e instanceof Error ? e.message : String(e);
    log(entries, 'err', 'parse', `babel parse failed: ${summary.error}`);
    return summary;
  }

  const symbolsMap = new Map<string, SymbolInfo>();
  let strLits = 0;
  let funcs = 0;
  const stringEntries: StringLiteralEntry[] = [];
  let stringIndex = 0;

  try {
    traverse(ast, {
      StringLiteral(path) {
        strLits++;
        const parent = path.parent;
        const parentKey = path.parentKey;
        const isImportSource =
          (parent.type === 'ImportDeclaration' || parent.type === 'ExportAllDeclaration' || parent.type === 'ExportNamedDeclaration')
          && parentKey === 'source';
        const isObjectKey =
          (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod')
          && parentKey === 'key'
          && !(parent as { computed?: boolean }).computed;
        if (isImportSource || isObjectKey) return;

        const value = path.node.value;
        if (value.length < 3) return;
        if (stringEntries.length >= STRING_ENTRY_LIMIT) return;

        const span = spanFromNode(path.node);
        if (!span) return;

        stringEntries.push({
          value,
          length: value.length,
          index: stringIndex++,
          startOffset: span.definitionStart!,
          endOffset: span.definitionEnd!,
          rangeStartLineNumber: span.rangeStartLineNumber,
          rangeStartColumn: span.rangeStartColumn,
          rangeEndLineNumber: span.rangeEndLineNumber,
          rangeEndColumn: span.rangeEndColumn,
        });
      },
      Function(path) {
        funcs++;
        if (!('params' in path.node)) return;
        for (const param of path.node.params) {
          if (param.type !== 'Identifier') continue;
          const binding = path.scope.getBinding(param.name);
          if (!binding) continue;
          const key = symbolTableKey(param.name, binding.scope.uid);
          if (symbolsMap.has(key)) continue;
          const span = spanFromNode(param);
          symbolsMap.set(key, {
            name: param.name,
            refCount: 0,
            isObfuscated: false,
            scope: `function@${binding.scope.uid}`,
            scopePath: scopePathOf(binding.scope),
            kind: 'param',
            ...span,
          });
        }
      },
      VariableDeclarator(path) {
        if (path.node.id.type !== 'Identifier') return;
        const name = path.node.id.name;
        const binding = path.scope.getBinding(name);
        if (!binding) return;
        const declKind = path.parent.type === 'VariableDeclaration' ? path.parent.kind : 'var';
        const key = symbolTableKey(name, binding.scope.uid);
        const span = spanFromNode(path.node.id);
        symbolsMap.set(key, {
          name,
          refCount: 0,
          isObfuscated: false,
          scope: `scope@${binding.scope.uid}`,
          scopePath: scopePathOf(binding.scope),
          kind: declKind as 'var' | 'let' | 'const',
          ...span,
        });
      },
      FunctionDeclaration(path) {
        if (!path.node.id) return;
        const name = path.node.id.name;
        const binding = path.scope.getBinding(name);
        if (!binding) return;
        const span = spanFromNode(path.node.id);
        symbolsMap.set(symbolTableKey(name, binding.scope.uid), {
          name,
          refCount: 0,
          isObfuscated: false,
          scope: `scope@${binding.scope.uid}`,
          scopePath: scopePathOf(binding.scope),
          kind: 'function',
          ...span,
        });
      },
    });

    traverse(ast, {
      ClassDeclaration(path) {
        addClassSyntheticSymbols(path, symbolsMap);
      },
      ClassExpression(path) {
        addClassSyntheticSymbols(path, symbolsMap);
      },
    });

    traverse(ast, {
      Scope(path) {
        for (const name of Object.keys(path.scope.bindings)) {
          const binding = path.scope.bindings[name];
          const sym = symbolsMap.get(symbolTableKey(name, binding.scope.uid));
          if (sym) sym.refCount = binding.references;
        }
      },
    });
  } catch (e) {
    log(entries, 'warn', 'parse', `traverse partial failure: ${e instanceof Error ? e.message : e}`);
  }

  const symbols = Array.from(symbolsMap.values());
  for (const s of symbols) {
    s.isObfuscated = isObfuscated(s.name, s.refCount);
  }
  summary.symbols = symbols;
  summary.variableCount = symbols.length;
  summary.stringLiteralCount = strLits;
  summary.functionCount = funcs;
  summary.obfuscatedCount = symbols.filter(s => s.isObfuscated).length;
  const body = ast.program.body;
  const outline: OutlineNode[] = body.map((node) => {
    const loc = node.loc as BabelLoc | null | undefined;
    const rangeFromLoc =
      loc?.start != null && loc.end != null
        ? {
            rangeStartLineNumber: loc.start.line,
            rangeStartColumn: loc.start.column + 1,
            rangeEndLineNumber: loc.end.line,
            rangeEndColumn: loc.end.column + 1,
          }
        : {};
    return {
      astType: node.type,
      start: node.start ?? 0,
      end: node.end ?? 0,
      line: node.loc?.start.line ?? 1,
      ...rangeFromLoc,
    };
  });
  summary.outline = outline;
  summary.parseSourceLength = code.length;

  stringEntries.sort((a, b) => b.length - a.length || a.index - b.index);
  summary.strings = stringEntries;
  if (stringEntries.length === STRING_ENTRY_LIMIT) {
    log(entries, 'warn', 'parse', `string-literal list capped at ${STRING_ENTRY_LIMIT}`);
  }

  if (config.includeAstTree) {
    if (code.length > AST_TREE_MAX_SOURCE_CHARS) {
      const reason = `source too large (${code.length} > ${AST_TREE_MAX_SOURCE_CHARS} chars)`;
      summary.astTreeSkipReason = reason;
      log(entries, 'warn', 'parse', `AST tree skipped: ${reason}`);
    } else {
      const slim = serializeAstToSlim(ast, AST_TREE_MAX_NODES);
      if (slim.ok) {
        summary.astRoot = slim.root;
        summary.astTreeNodeCount = slim.nodeCount;
        log(entries, 'ok', 'parse', `slim AST: ${slim.nodeCount} nodes`);
      } else {
        summary.astTreeSkipReason = slim.skipReason;
        log(entries, 'warn', 'parse', `AST tree skipped: ${slim.skipReason}`);
      }
    }
  }

  summary.ok = true;

  log(entries, 'ok', 'parse',
    `${summary.variableCount} bindings · ${summary.stringLiteralCount} strings · ${summary.functionCount} functions · ${summary.obfuscatedCount} suspicious`
  );
  return summary;
}

/**
 * Execute a batch of renames against `input` in the worker, then re-parse so
 * the symbol table the UI shows is consistent with the renamed code. Single
 * F2 renames and queue applyAll both route through here so we never re-parse
 * on the main thread.
 */
function handleRenameBatch(msg: RenameBatchMessage): void {
  const { jobId, input, config, ops } = msg;
  const entries: LogEntry[] = [];
  log(entries, 'info', 'rename', `batch · ${ops.length} ops`);

  const t0 = Date.now();
  const result = batchRenameBindings(input, ops);
  const t1 = Date.now();
  log(entries, 'ok', 'rename', `applied ${result.applied.length} / skipped ${result.skipped.length} · ${t1 - t0}ms`);

  // Re-parse for AST/symbols only (renames are textual; skip format/deobfuscate).
  let summary: ParseSummary | null = null;
  try {
    summary = runParse(result.code, config, entries);
  } catch (e) {
    log(entries, 'warn', 'rename', `post-rename parse failed: ${e instanceof Error ? e.message : e}`);
  }

  const done: RenameBatchDoneMessage = {
    type: 'renameBatchDone',
    jobId,
    code: result.code,
    applied: result.applied,
    skipped: result.skipped.map((s) => ({ from: s.op.from, to: s.op.to, reason: s.reason })),
    summary,
    log: entries,
  };
  self.postMessage(done);
}

self.addEventListener('message', async (ev: MessageEvent<PipelineMessage | RenameBatchMessage>) => {
  const msg = ev.data;
  if (msg.type === 'renameBatch') {
    handleRenameBatch(msg);
    return;
  }
  if (msg.type !== 'run') return;
  const { jobId, input, config } = msg;
  const entries: LogEntry[] = [];
  let formattedInput: string | undefined;

  try {
    log(entries, 'info', 'pipeline', `start · input ${input.length} chars · engine=${config.engine}`);
    let code = input;
    const enabledSteps = config.steps.filter(s => s.enabled);
    let progressBase = 0;
    const slice = 100 / Math.max(1, enabledSteps.length);

    for (const step of enabledSteps) {
      postProgress(jobId, step.id, progressBase);
      if (step.id === 'format') {
        code = await runFormat(code, config, entries);
        formattedInput = await runFormat(input, config, entries);
      } else if (step.id === 'deobfuscate') {
        const before = code;
        try {
          code = await runDeobfuscate(code, config, entries);
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          log(entries, 'err', 'deobfuscate', `all engines failed: ${m}`);
          log(entries, 'warn', 'deobfuscate', 'continuing with formatted (non-deobfuscated) code so you can still rename manually');
          code = before;
        }
        try {
          code = jsBeautify.js_beautify(
            code,
            buildJsBeautifyOptions({ indentSize: config.indentSize, printWidth: config.printWidth }),
          );
        } catch { /* ignore */ }
      } else if (step.id === 'parse') {
        const summary = runParse(code, config, entries);
        progressBase += slice;
        postProgress(jobId, step.id, progressBase);
        log(entries, 'ok', 'pipeline', `done · output ${code.length} chars`);
        const done: DoneMessage = {
          type: 'done',
          jobId,
          result: {
            output: code,
            log: entries,
            summary,
            ...(formattedInput !== undefined ? { formattedInput } : {}),
          },
        };
        self.postMessage(done);
        return;
      }
      progressBase += slice;
      postProgress(jobId, step.id, progressBase);
    }
    log(entries, 'ok', 'pipeline', `done · output ${code.length} chars`);
    const done: DoneMessage = {
      type: 'done',
      jobId,
      result: {
        output: code,
        log: entries,
        summary: null,
        ...(formattedInput !== undefined ? { formattedInput } : {}),
      },
    };
    self.postMessage(done);
  } catch (e) {
    const msg2: ErrorMessage = { type: 'error', jobId, error: e instanceof Error ? e.message : String(e) };
    log(entries, 'err', 'pipeline', `pipeline aborted: ${msg2.error}`);
    self.postMessage({
      type: 'done',
      jobId,
      result: {
        output: input,
        log: entries,
        summary: null,
        ...(formattedInput !== undefined ? { formattedInput } : {}),
      },
    });
  }
});

export {};
