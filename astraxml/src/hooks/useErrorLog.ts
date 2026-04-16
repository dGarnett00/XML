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

          unlisten = await listen<LogEntry>('error:log', (event) => {
            // Backend entries arrive with all v2 fields pre-populated.
            // Ensure defaults for any missing optional fields.
            const entry: LogEntry = {
              ...event.payload,
              traceId:     event.payload.traceId     ?? null,
              spanId:      event.payload.spanId       ?? null,
              durationMs:  event.payload.durationMs   ?? null,
              fingerprint: event.payload.fingerprint  ?? null,
              tags:        event.payload.tags         ?? [],
              breadcrumbs: event.payload.breadcrumbs  ?? [],
              seq:         event.payload.seq          ?? 0,
            };
            push(entry);
          });
        } catch {
          // Tauri APIs unavailable (browser dev mode) — silently ignore.
        }
      })();
    }

    // ── 2. Global synchronous JS error capture ────────────────────────
    const prevOnError = window.onerror;
    window.onerror = (msg, src, line, col, err) => {
      const source = src ? `${src}:${line ?? 0}:${col ?? 0}` : 'window';
      const message = typeof msg === 'string' ? msg : String(msg);
      push({
        id:          crypto.randomUUID(),
        sessionId:   useErrorLogStore.getState().sessionId || 'ui',
        timestamp:   new Date().toISOString(),
        severity:    'error',
        category:    'ui',
        source,
        message,
        detail:      err?.stack ?? null,
        context:     {},
        traceId:     null,
        spanId:      null,
        durationMs:  null,
        fingerprint: uiFingerprint(source, message),
        tags:        ['js-error'],
        breadcrumbs: [],
        seq:         0,
      });
      if (typeof prevOnError === 'function') {
        return prevOnError.call(window, msg, src, line, col, err);
      }
      return false;
    };

    // ── 3. Unhandled Promise rejection capture ────────────────────────
    const onUnhandledRejection = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason as Error | null | undefined;
      const message = reason?.message ?? String(ev.reason);
      push({
        id:          crypto.randomUUID(),
        sessionId:   useErrorLogStore.getState().sessionId || 'ui',
        timestamp:   new Date().toISOString(),
        severity:    'error',
        category:    'ui',
        source:      'Promise',
        message,
        detail:      reason?.stack ?? null,
        context:     {},
        traceId:     null,
        spanId:      null,
        durationMs:  null,
        fingerprint: uiFingerprint('Promise', message),
        tags:        ['unhandled-rejection'],
        breadcrumbs: [],
        seq:         0,
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
