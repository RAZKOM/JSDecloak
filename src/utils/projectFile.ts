import type { Annotation, PipelineConfig, ProjectFile, RenameOp } from '../types';

export function isProjectFile(value: unknown): value is ProjectFile {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'jsdecloak-project') return false;
  if (typeof v.version !== 'number') return false;
  if (typeof v.input !== 'string') return false;
  if (typeof v.output !== 'string') return false;
  if (!v.config || typeof v.config !== 'object') return false;
  if (!Array.isArray(v.renames)) return false;
  if (!Array.isArray(v.annotations)) return false;
  return true;
}

export function buildProjectFile(args: {
  fileName: string | null;
  input: string;
  output: string;
  config: PipelineConfig;
  renames: RenameOp[];
  annotations: Annotation[];
}): ProjectFile {
  return {
    kind: 'jsdecloak-project',
    version: 1,
    savedAt: Date.now(),
    fileName: args.fileName,
    input: args.input,
    output: args.output,
    config: args.config,
    renames: args.renames,
    annotations: args.annotations,
  };
}

/**
 * Coerce a loosely-validated project file into the typed shape, filling
 * defaults for missing optional fields.
 */
export function normalizeProject(raw: ProjectFile): ProjectFile {
  return {
    kind: 'jsdecloak-project',
    version: 1,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : Date.now(),
    fileName: typeof raw.fileName === 'string' ? raw.fileName : null,
    input: raw.input ?? '',
    output: raw.output ?? '',
    config: raw.config,
    renames: Array.isArray(raw.renames) ? raw.renames : [],
    annotations: Array.isArray(raw.annotations) ? raw.annotations : [],
  };
}
