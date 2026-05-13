export type DeobEngine = 'wakaru' | 'synchrony' | 'webcrack' | 'none';

export type StepId = 'format' | 'deobfuscate' | 'parse';

export interface PipelineStep {
  id: StepId;
  enabled: boolean;
  label: string;
  description: string;
}

export interface PipelineConfig {
  steps: PipelineStep[];
  engine: DeobEngine;
  printWidth: number;
  indentSize: number;
  parseJsx: boolean;
  parseTypescript: boolean;
  includeAstTree: boolean;
  wakaruAggressive: boolean;
}

export interface AstSlimNode {
  type: string;
  start: number;
  end: number;
  children: AstSlimNode[];
  rangeStartLineNumber?: number;
  rangeStartColumn?: number;
  rangeEndLineNumber?: number;
  rangeEndColumn?: number;
}

export type LogLevel = 'info' | 'ok' | 'warn' | 'err';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  source: string;
  message: string;
}

export interface SymbolInfo {
  name: string;
  refCount: number;
  isObfuscated: boolean;
  scope: string;
  scopePath: string;
  kind:
    | 'var'
    | 'let'
    | 'const'
    | 'function'
    | 'param'
    | 'class'
    | 'import'
    | 'method'
    | 'instanceProp';
  definitionStart?: number;
  definitionEnd?: number;
  definitionLine?: number;
  rangeStartLineNumber?: number;
  rangeStartColumn?: number;
  rangeEndLineNumber?: number;
  rangeEndColumn?: number;
}

export interface OutlineNode {
  astType: string;
  start: number;
  end: number;
  line: number;
  rangeStartLineNumber?: number;
  rangeStartColumn?: number;
  rangeEndLineNumber?: number;
  rangeEndColumn?: number;
}

export interface OutputRevealRequest {
  parseSourceLength: number;
  rangeStartLineNumber?: number;
  rangeStartColumn?: number;
  rangeEndLineNumber?: number;
  rangeEndColumn?: number;
  startOffset?: number;
  endOffset?: number;
}

export interface ParseSummary {
  ok: boolean;
  variableCount: number;
  stringLiteralCount: number;
  functionCount: number;
  obfuscatedCount: number;
  symbols: SymbolInfo[];
  outline?: OutlineNode[];
  parseSourceLength?: number;
  astRoot?: AstSlimNode;
  astTreeSkipReason?: string;
  astTreeNodeCount?: number;
  strings?: StringLiteralEntry[];
  error?: string;
}

export interface PipelineResult {
  output: string;
  log: LogEntry[];
  summary: ParseSummary | null;
  formattedInput?: string;
}

export interface RenameOp {
  from: string;
  to: string;
  ts: number;
  scopePath?: string;
}

export interface Annotation {
  name: string;
  scopePath: string;
  note: string;
  tag?: string;
  ts: number;
}

export interface StringLiteralEntry {
  value: string;
  length: number;
  index: number;
  rangeStartLineNumber?: number;
  rangeStartColumn?: number;
  rangeEndLineNumber?: number;
  rangeEndColumn?: number;
  startOffset: number;
  endOffset: number;
}

export interface ProjectFile {
  kind: 'jsdecloak-project';
  version: 1;
  savedAt: number;
  fileName: string | null;
  input: string;
  output: string;
  config: PipelineConfig;
  renames: RenameOp[];
  annotations: Annotation[];
}
