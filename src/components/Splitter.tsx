import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  direction: 'vertical' | 'horizontal';
  initial?: number; // percent 0-100
  min?: number;
  max?: number;
  first: React.ReactNode;
  second: React.ReactNode;
  className?: string;
}

export function Splitter({ direction, initial = 50, min = 15, max = 85, first, second, className = '' }: Props) {
  const [pos, setPos] = useState(initial);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const onMouseDown = useCallback(() => {
    draggingRef.current = true;
    document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [direction]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let p;
      if (direction === 'vertical') {
        p = ((e.clientX - rect.left) / rect.width) * 100;
      } else {
        p = ((e.clientY - rect.top) / rect.height) * 100;
      }
      p = Math.max(min, Math.min(max, p));
      if (!Number.isFinite(p)) return;
      setPos(p);
    }
    function onUp() {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [direction, min, max]);

  const isV = direction === 'vertical';
  return (
    <div
      ref={containerRef}
      className={`relative flex ${isV ? 'flex-row' : 'flex-col'} w-full h-full ${className}`}
    >
      <div style={{ flexBasis: `${pos}%` }} className="overflow-hidden">{first}</div>
      <div
        onMouseDown={onMouseDown}
        className={`splitter ${isV ? 'splitter-v' : 'splitter-h'} flex-shrink-0`}
      />
      <div style={{ flexBasis: `${100 - pos}%` }} className="overflow-hidden">{second}</div>
    </div>
  );
}
