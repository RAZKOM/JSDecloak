import type { Dispatch, SetStateAction } from 'react';
import type { IDisposable } from 'monaco-editor';
import type { LogEntry, RenameOp } from '../types';
import { renameBinding } from '../utils/rename';

type MonacoModule = typeof import('monaco-editor');

export const OUTPUT_PANEL_URI_PATTERN = '**/jsdecloak-output/**';

export interface OutputRenameBridge {
  appendLog: (entries: LogEntry[]) => void;
  setRenameOps: Dispatch<SetStateAction<RenameOp[]>>;
  recordOutputRenameFrame?: (frame: { before: string; after: string; op: RenameOp }) => void;
  onRenamed?: (op: { from: string; to: string; scopePath?: string; codeAfterRename: string }) => void;
}

let renameDisposable: IDisposable | null = null;

export function registerOutputRenameProvider(
  monaco: MonacoModule,
  getBridge: () => OutputRenameBridge
): IDisposable {
  renameDisposable?.dispose();
  renameDisposable = null;

  renameDisposable = monaco.languages.registerRenameProvider(
    {
      language: 'javascript',
      pattern: OUTPUT_PANEL_URI_PATTERN,
      exclusive: true,
    },
    {
      provideRenameEdits(model, position, newName) {
        const word = model.getWordAtPosition(position);
        if (!word?.word) {
          return { edits: [], rejectReason: 'No identifier at cursor' };
        }
        const oldName = word.word;
        if (!newName.trim() || newName === oldName) {
          return { edits: [], rejectReason: 'Name unchanged' };
        }

        const code = model.getValue();
        const result = renameBinding(code, oldName, newName, {
          line: position.lineNumber,
          column: position.column - 1,
        });
        if (result.error) {
          return { edits: [], rejectReason: result.error };
        }

        const bridge = getBridge();
        const op: RenameOp = {
          from: oldName,
          to: newName,
          ts: Date.now(),
          ...(result.scopePath ? { scopePath: result.scopePath } : {}),
        };
        bridge.setRenameOps((prev) => [...prev, op]);
        bridge.recordOutputRenameFrame?.({ before: code, after: result.code, op });
        bridge.onRenamed?.({
          from: oldName,
          to: newName,
          codeAfterRename: result.code,
          ...(result.scopePath ? { scopePath: result.scopePath } : {}),
        });
        bridge.appendLog([
          {
            ts: Date.now(),
            level: 'ok',
            source: 'rename',
            message: `"${oldName}" → "${newName}" · ${result.renamed} references updated`,
          },
        ]);

        const fullRange = model.getFullModelRange();
        return {
          edits: [
            {
              resource: model.uri,
              versionId: model.getVersionId(),
              textEdit: { range: fullRange, text: result.code },
            },
          ],
        };
      },
    }
  );

  return renameDisposable;
}

export function disposeOutputRenameProvider(): void {
  renameDisposable?.dispose();
  renameDisposable = null;
}
