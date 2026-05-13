import { useEffect, useRef } from 'react';
import { saveSession } from '../utils/sessionStore';

/** Debounced IndexedDB session save. `enabled` waits for hydration so the first render does not overwrite a stored session. */
export function useAutosave(payload: unknown, opts: { enabled: boolean; delayMs?: number; onError?: (e: unknown) => void }): void {
  const { enabled, delayMs = 800, onError } = opts;
  const timerRef = useRef<number | null>(null);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!enabled) return;
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      saveSession(payload).catch((e) => onErrorRef.current?.(e));
    }, delayMs);

    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [payload, enabled, delayMs]);
}
