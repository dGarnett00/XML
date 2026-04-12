/**
 * AstraXML — Error Log Store
 *
 * A Zustand-powered bounded ring-buffer for structured log entries.
 *
 * Architecture
 * ────────────
 * • LogEntry  — immutable event object matching the Rust `LogEntry` schema
 * • LogStore  — max-1 000 ring-buffer with filter + count helpers
 * • Severity / Category — string-literal union types (no enum overhead)
 *
 * The store is the single source of truth for the ErrorLogPanel.  All entries
 * originate from one of three capture paths:
 *
 *   1. Tauri `"error:log"` IPC event  → `push()`   (Rust backend errors)
 *   2. `window.onerror`               → `push()`   (unhandled JS exceptions)
 *   3. `unhandledrejection`            → `push()`   (unhandled Promise rejections)
 */

import { create } from 'zustand';

// ── Types ─────────────────────────────────────────────────────────────────

export type LogSeverity = 'fatal' | 'error' | 'warn' | 'info' | 'debug';

export type LogCategory =
  | 'parse'
  | 'db'
  | 'io'
  | 'validation'
  | 'rule'
  | 'snapshot'
  | 'serialization'
  | 'command'
  | 'ui'
  | 'unknown';

export interface LogEntry {
  /** UUIDv4 unique to this event. */
  id: string;
  /** Shared across all entries in the same backend session. */
  sessionId: string;
  /** ISO-8601 timestamp with millisecond precision. */
  timestamp: string;
  severity: LogSeverity;
  category: LogCategory;
  /** E.g. "editor::open_document" or "Promise" for UI rejections. */
  source: string;
  /** Primary human-readable message. */
  message: string;
  /** Extended detail or stack trace, if available. */
  detail: string | null;
  /** Arbitrary key-value context supplied at the call site. */
  context: Record<string, string>;
}

/** Numeric order for severity comparisons (higher = more severe). */
const SEVERITY_RANK: Record<LogSeverity, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
  fatal: 4,
};

// ── Store shape ───────────────────────────────────────────────────────────

const MAX_ENTRIES = 1_000;

interface ErrorLogState {
  entries:        LogEntry[];
  isVisible:      boolean;
  autoScroll:     boolean;
  severityFilter: LogSeverity | 'all';
  categoryFilter: LogCategory | 'all';
  searchQuery:    string;
  /** The backend session ID — populated via get_session_id on app start. */
  sessionId:      string;

  // ── Mutations ─────────────────────────────────────────────────────────
  push:              (entry: LogEntry) => void;
  clear:             () => void;
  toggleVisible:     () => void;
  setVisible:        (v: boolean) => void;
  setSessionId:      (id: string) => void;
  setSeverityFilter: (f: LogSeverity | 'all') => void;
  setCategoryFilter: (f: LogCategory | 'all') => void;
  setSearchQuery:    (q: string) => void;
  setAutoScroll:     (v: boolean) => void;

  // ── Derived (call as functions to access latest state snapshot) ───────
  filteredEntries: () => LogEntry[];
  countBySeverity: (sev: LogSeverity) => number;
  /** Count of entries at or above the given minimum severity. */
  countAbove:      (min: LogSeverity) => number;
}

// ── Store ─────────────────────────────────────────────────────────────────

export const useErrorLogStore = create<ErrorLogState>((set, get) => ({
  entries:        [],
  isVisible:      false,
  autoScroll:     true,
  severityFilter: 'all',
  categoryFilter: 'all',
  searchQuery:    '',
  sessionId:      '',

  // ── Mutations ─────────────────────────────────────────────────────────

  push: (entry) =>
    set((state) => {
      const entries =
        state.entries.length >= MAX_ENTRIES
          ? [...state.entries.slice(1), entry]
          : [...state.entries, entry];
      return { entries };
    }),

  clear: () => set({ entries: [] }),

  toggleVisible: () => set((s) => ({ isVisible: !s.isVisible })),
  setVisible:    (v) => set({ isVisible: v }),
  setSessionId:  (id) => set({ sessionId: id }),

  setSeverityFilter: (f) => set({ severityFilter: f }),
  setCategoryFilter: (f) => set({ categoryFilter: f }),
  setSearchQuery:    (q) => set({ searchQuery: q }),
  setAutoScroll:     (v) => set({ autoScroll: v }),

  // ── Derived ───────────────────────────────────────────────────────────

  filteredEntries: () => {
    const { entries, severityFilter, categoryFilter, searchQuery } = get();
    return entries.filter((e) => {
      if (
        severityFilter !== 'all' &&
        SEVERITY_RANK[e.severity] < SEVERITY_RANK[severityFilter]
      )
        return false;
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const haystack =
          e.message.toLowerCase() +
          ' ' +
          e.source.toLowerCase() +
          ' ' +
          (e.detail ?? '').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  },

  countBySeverity: (sev) =>
    get().entries.filter((e) => e.severity === sev).length,

  countAbove: (min) =>
    get().entries.filter((e) => SEVERITY_RANK[e.severity] >= SEVERITY_RANK[min])
      .length,
}));
