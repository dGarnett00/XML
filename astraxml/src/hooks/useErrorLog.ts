/**
 * AstraXML — useErrorLog hook (v2)
 *
 * Mount this hook **once** at the app root.  It wires up three error-capture
 * paths and routes all captured events into `useErrorLogStore`:
 *
 *   1. Tauri `"error:log"` IPC event stream  — Rust backend errors/events
 *   2. `window.onerror`                       — unhandled synchronous JS errors
 *   3. `unhandledrejection`                    — unhandled Promise rejections
 *
 * v2 additions:
 *   • Populates new LogEntry fields (traceId, spanId, durationMs, fingerprint,
 *     tags, breadcrumbs, seq) for UI-generated entries.
 *   • Uses crypto.randomUUID() for trace/span IDs.
 */

import { useEffect } from 'react';
import { useErrorLogStore, LogEntry } from '../store/errorLog';
import { isTauri } from '../lib/tauri';

/** Compute a simple string hash for fingerprinting UI errors. */
function uiFingerprint(source: string, message: string): string {
  let h = 0x811c9dc5;
  const str = source + '|' + message.slice(0, 80);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Build a UI-originated log entry with sensible defaults. */
function uiEntry(source: string, message: string, tag: string, detail?: string | null): LogEntry {
  return {
    id: crypto.randomUUID(),
    sessionId: useErrorLogStore.getState().sessionId || 'ui',
    timestamp: new Date().toISOString(),
    severity: 'error', category: 'ui', source, message,
    detail: detail ?? null, context: {},
    traceId: null, spanId: null, durationMs: null,
    fingerprint: uiFingerprint(source, message),
    tags: [tag], breadcrumbs: [], seq: 0,
  };
}

/** Ensure optional v2 fields from backend payloads have defaults. */
const withDefaults = (p: LogEntry): LogEntry => ({
  ...p,
  traceId: p.traceId ?? null,  spanId: p.spanId ?? null,
  durationMs: p.durationMs ?? null, fingerprint: p.fingerprint ?? null,
  tags: p.tags ?? [],  breadcrumbs: p.breadcrumbs ?? [],  seq: p.seq ?? 0,
});

export function useErrorLog(): void {
  const push       = useErrorLogStore((s) => s.push);
  const setSession = useErrorLogStore((s) => s.setSessionId);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    // ── 1. Tauri IPC event listener ───────────────────────────────────
    if (isTauri()) {
      (async () => {
        try {
          const { listen } = await import('@tauri-apps/api/event');
          const { invoke } = await import('@tauri-apps/api/core');

          const sessionId = await invoke<string>('get_session_id');
          setSession(sessionId);

          unlisten = await listen<LogEntry>('error:log', (e) => push(withDefaults(e.payload)));
        } catch { /* Tauri unavailable (browser dev mode) */ }
      })();
    }

    // ── 2. Global synchronous JS error capture ────────────────────────
    const prevOnError = window.onerror;
    window.onerror = (msg, src, line, col, err) => {
      const source = src ? `${src}:${line ?? 0}:${col ?? 0}` : 'window';
      push(uiEntry(source, typeof msg === 'string' ? msg : String(msg), 'js-error', err?.stack));
      return typeof prevOnError === 'function'
        ? prevOnError.call(window, msg, src, line, col, err)
        : false;
    };

    // ── 3. Unhandled Promise rejection capture ────────────────────────
    const onUnhandledRejection = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason as Error | null | undefined;
      push(uiEntry('Promise', reason?.message ?? String(ev.reason), 'unhandled-rejection', reason?.stack));
    };
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      if (unlisten) unlisten();
      window.onerror = prevOnError;
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [push, setSession]);
}
