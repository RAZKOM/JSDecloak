import type { Annotation } from '../types';

export function annotationKey(name: string, scopePath: string): string {
  return `${name}@${scopePath}`;
}

export function findAnnotation(
  annotations: ReadonlyArray<Annotation>,
  name: string,
  scopePath: string,
): Annotation | undefined {
  return annotations.find((a) => a.name === name && a.scopePath === scopePath);
}

export function upsertAnnotation(
  annotations: ReadonlyArray<Annotation>,
  next: Annotation,
): Annotation[] {
  const trimmed = next.note.trim();
  const tagTrimmed = next.tag?.trim() ?? '';
  const filtered = annotations.filter(
    (a) => !(a.name === next.name && a.scopePath === next.scopePath),
  );
  if (!trimmed && !tagTrimmed) return filtered;
  return [
    ...filtered,
    {
      ...next,
      note: trimmed,
      tag: tagTrimmed || undefined,
      ts: Date.now(),
    },
  ];
}

/**
 * When the user renames `oldName → newName` at a known scope path, migrate any
 * existing annotation key so the note stays attached to the binding rather
 * than the old identifier.
 */
export function migrateAnnotationOnRename(
  annotations: ReadonlyArray<Annotation>,
  oldName: string,
  newName: string,
  scopePath: string | undefined,
): Annotation[] {
  if (!scopePath) return [...annotations];
  return annotations.map((a) =>
    a.name === oldName && a.scopePath === scopePath
      ? { ...a, name: newName }
      : a,
  );
}
