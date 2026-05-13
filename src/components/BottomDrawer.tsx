import { useCallback, useState } from 'react';
import { DrawerLog } from './DrawerLog';
import type { LogEntry, OutputRevealRequest, ParseSummary, RenameOp } from '../types';

interface Props {
  log: LogEntry[];
  summary: ParseSummary | null;
  renames: RenameOp[];
  onClear: () => void;
  onRevealInOutput: (req: OutputRevealRequest) => void;
}

export function BottomDrawer({ log, summary, renames, onClear, onRevealInOutput }: Props) {
  const [open, setOpen] = useState(true);
  const [height, setHeight] = useState(280);
  const [dragging, setDragging] = useState(false);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = height;
      setDragging(true);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';

      function onMove(ev: MouseEvent) {
        setHeight(Math.max(120, Math.min(700, startH - (ev.clientY - startY))));
      }
      function onUp() {
        setDragging(false);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [height],
  );

  return (
    <div
      style={{
        height: open ? height : 32,
        transition: dragging ? 'none' : 'height 200ms ease',
        flexShrink: 0,
      }}
      className="relative flex flex-col"
    >
      {open && (
        <div className="splitter splitter-h shrink-0" onMouseDown={onResizeStart} />
      )}
      <DrawerLog
        open={open}
        log={log}
        summary={summary}
        renames={renames}
        onToggle={() => setOpen((o) => !o)}
        onClear={onClear}
        onRevealInOutput={onRevealInOutput}
      />
    </div>
  );
}
