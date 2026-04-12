/**
 * AstraXML — useErrorLog hook
 *
 * Mount this hook **once** at the app root.  It wires up three error-capture
 * paths and routes all captured events into `useErrorLogStore`:
 *
 *   1. Tauri `"error:log"` IPC event stream  — Rust backend errors/events
 *   2. `window.onerror`                       — unhandled synchronous JS errors
 *   3. `unhandledrejection`                    — unhandled Promise rejections
 *
 * On first mount it also calls `get_session_id` so that any UI-generated
 * entries can share the same session ID as the backend.
 *
 * Cleanup is handled automatically on unmount.
 */

import { useEffect } from 'react';
import { useErrorLogStore, LogEntry } from '../store/errorLog';

const isTauri = (): boolean =>
  typeof (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] !== 'undefined';

export function useErrorLog(): void {
  const push      = useErrorLogStore((s) => s.push);
  const setSession = useErrorLogStore((s) => s.setSessionId);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    // ── 1. Tauri IPC event listener ───────────────────────────────────
    if (isTauri()) {
      (async () => {
        try {
          const { listen } = await import('@tauri-apps/api/event');
          const { invoke } = await import('@tauri-apps/api/core');

          // Fetch the backend session ID once so UI entries can match it.
          const sessionId = await invoke<string>('get_session_id');
          setSession(sessionId);

          unlisten = await listen<LogEntry>('error:log', (event) => {
            push(event.payload);
          });
        } catch {
          // Tauri APIs unavailable (browser dev mode) — silently ignore.
        }
      })();
    }

    // ── 2. Global synchronous JS error capture ────────────────────────
    const prevOnError = window.onerror;
    window.onerror = (msg, src, line, col, err) => {
      push({
        id:        crypto.randomUUID(),
        sessionId: useErrorLogStore.getState().sessionId || 'ui',
        timestamp: new Date().toISOString(),
        severity:  'error',
        category:  'ui',
        source:    src ? `${src}:${line ?? 0}:${col ?? 0}` : 'window',
        message:   typeof msg === 'string' ? msg : String(msg),
        detail:    err?.stack ?? null,
        context:   {},
      });
      if (typeof prevOnError === 'function') {
        return prevOnError.call(window, msg, src, line, col, err);
      }
      return false;
    };

    // ── 3. Unhandled Promise rejection capture ────────────────────────
    const onUnhandledRejection = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason as Error | null | undefined;
      push({
        id:        crypto.randomUUID(),
        sessionId: useErrorLogStore.getState().sessionId || 'ui',
        timestamp: new Date().toISOString(),
        severity:  'error',
        category:  'ui',
        source:    'Promise',
        message:   reason?.message ?? String(ev.reason),
        detail:    reason?.stack   ?? null,
        context:   {},
      });
    };
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      if (unlisten) unlisten();
      window.onerror = prevOnError;
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [push, setSession]);
}
