/**
 * AstraXML — Error Log Store  (v2 — Revolutionary Overhaul)
 *
 * A Zustand-powered bounded ring-buffer for structured log entries with:
 *
 *   • Trace correlation    — group entries by traceId
 *   • Fingerprint grouping — auto-collapse repeated errors
 *   • Performance timing   — track operation durations
 *   • Breadcrumb trails    — action history attached to errors
 *   • Pinned entries       — user-pinned for investigation
 *   • Rate tracking        — errors/min, burst detection
 *   • Multi-tab views      — List / Timeline / Grouped / Stats
 *   • Advanced filtering   — tag-based, time-range, regex search
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

export type LogTab = 'list' | 'timeline' | 'grouped' | 'stats';

export interface Breadcrumb {
  timestamp: string;
  label: string;
  data: string | null;
}

export interface LogEntry {
  id: string;
  sessionId: string;
  timestamp: string;
  severity: LogSeverity;
  category: LogCategory;
  source: string;
  message: string;
  detail: string | null;
  context: Record<string, string>;
  // v2 fields
  traceId: string | null;
  spanId: string | null;
  durationMs: number | null;
  fingerprint: string | null;
  tags: string[];
  breadcrumbs: Breadcrumb[];
  seq: number;
}

/** A grouped entry formed by collapsing entries with the same fingerprint. */
export interface GroupedEntry {
  fingerprint: string;
  severity: LogSeverity;
  category: LogCategory;
  source: string;
  message: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  entries: LogEntry[];
}

/** A time-bucket for the rate sparkline. */
export interface RateBucket {
  time: string;
  total: number;
  errors: number;
  warnings: number;
}

/** Numeric order for severity comparisons (higher = more severe). */
export const SEVERITY_RANK: Record<LogSeverity, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
  fatal: 4,
};

// ── Store shape ───────────────────────────────────────────────────────────

const MAX_ENTRIES = 5_000;
const MAX_RATE_BUCKETS = 30;

interface ErrorLogState {
  entries:        LogEntry[];
  isVisible:      boolean;
  autoScroll:     boolean;
  severityFilter: LogSeverity | 'all';
  categoryFilter: LogCategory | 'all';
  searchQuery:    string;
  sessionId:      string;

  // v2 state
  activeTab:      LogTab;
  pinnedIds:      Set<string>;
  tagFilter:      string[];
  traceFilter:    string | null;
  rateBuckets:    RateBucket[];
  newEntryPulse:  LogSeverity | null;

  // ── Mutations ─────────────────────────────────────────────────────────
  push:              (entry: LogEntry) => void;
  pushBatch:         (entries: LogEntry[]) => void;
  clear:             () => void;
  toggleVisible:     () => void;
  setVisible:        (v: boolean) => void;
  setSessionId:      (id: string) => void;
  setSeverityFilter: (f: LogSeverity | 'all') => void;
  setCategoryFilter: (f: LogCategory | 'all') => void;
  setSearchQuery:    (q: string) => void;
  setAutoScroll:     (v: boolean) => void;
  setActiveTab:      (tab: LogTab) => void;
  togglePin:         (id: string) => void;
  setTagFilter:      (tags: string[]) => void;
  setTraceFilter:    (traceId: string | null) => void;
  clearPulse:        () => void;

  // ── Derived ───────────────────────────────────────────────────────────
  filteredEntries: () => LogEntry[];
  groupedEntries:  () => GroupedEntry[];
  pinnedEntries:   () => LogEntry[];
  traceEntries:    (traceId: string) => LogEntry[];
  countBySeverity: (sev: LogSeverity) => number;
  countAbove:      (min: LogSeverity) => number;
  allTags:         () => string[];
  allTraceIds:     () => string[];
  currentRate:     () => { errorsPerMin: number; totalPerMin: number };
}

// ── Rate bucket helpers ───────────────────────────────────────────────────

function bucketKey(ts: string): string {
  const d = new Date(ts);
  d.setSeconds(0, 0);
  return d.toISOString();
}

function updateBuckets(buckets: RateBucket[], entry: LogEntry): RateBucket[] {
  const key = bucketKey(entry.timestamp);
  const isErr  = SEVERITY_RANK[entry.severity] >= SEVERITY_RANK.error;
  const isWarn = entry.severity === 'warn';
  const idx = buckets.findIndex((b) => b.time === key);

  const arr = idx >= 0
    ? buckets.map((b, i) => i !== idx ? b : {
        ...b, total: b.total + 1,
        errors: b.errors + +isErr, warnings: b.warnings + +isWarn,
      })
    : [...buckets, { time: key, total: 1, errors: +isErr, warnings: +isWarn }];

  return arr.length > MAX_RATE_BUCKETS ? arr.slice(-MAX_RATE_BUCKETS) : arr;
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

  activeTab:      'list',
  pinnedIds:      new Set(),
  tagFilter:      [],
  traceFilter:    null,
  rateBuckets:    [],
  newEntryPulse:  null,

  // ── Mutations ─────────────────────────────────────────────────────────

  push: (entry) =>
    set((state) => ({
      entries: [...state.entries.slice(-(MAX_ENTRIES - 1)), entry],
      rateBuckets: updateBuckets(state.rateBuckets, entry),
      newEntryPulse: SEVERITY_RANK[entry.severity] >= SEVERITY_RANK.error
        ? entry.severity : state.newEntryPulse,
    })),

  pushBatch: (batch) =>
    set((state) => ({
      entries: [...state.entries, ...batch].slice(-MAX_ENTRIES),
      rateBuckets: batch.reduce(updateBuckets, state.rateBuckets),
    })),

  clear: () => set({ entries: [], rateBuckets: [], pinnedIds: new Set() }),

  toggleVisible: () => set((s) => ({ isVisible: !s.isVisible })),
  setVisible:    (v) => set({ isVisible: v }),
  setSessionId:  (id) => set({ sessionId: id }),

  setSeverityFilter: (f) => set({ severityFilter: f }),
  setCategoryFilter: (f) => set({ categoryFilter: f }),
  setSearchQuery:    (q) => set({ searchQuery: q }),
  setAutoScroll:     (v) => set({ autoScroll: v }),
  setActiveTab:      (tab) => set({ activeTab: tab }),
  setTagFilter:      (tags) => set({ tagFilter: tags }),
  setTraceFilter:    (traceId) => set({ traceFilter: traceId }),
  clearPulse:        () => set({ newEntryPulse: null }),

  togglePin: (id) =>
    set((state) => {
      const next = new Set(state.pinnedIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { pinnedIds: next };
    }),

  // ── Derived ───────────────────────────────────────────────────────────

  filteredEntries: () => {
    const { entries, severityFilter, categoryFilter, searchQuery, tagFilter, traceFilter } = get();
    return entries.filter((e) => {
      if (severityFilter !== 'all' && SEVERITY_RANK[e.severity] < SEVERITY_RANK[severityFilter])
        return false;
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
      if (traceFilter && e.traceId !== traceFilter) return false;
      if (tagFilter.length > 0 && !tagFilter.some((t) => e.tags.includes(t))) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (![e.message, e.source, e.detail ?? '', ...e.tags]
              .some((s) => s.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  },

  groupedEntries: () => {
    const filtered = get().filteredEntries();
    const map = new Map<string, GroupedEntry>();
    for (const e of filtered) {
      const fp = e.fingerprint || e.id;
      const existing = map.get(fp);
      if (existing) {
        existing.count++;
        if (e.timestamp < existing.firstSeen) existing.firstSeen = e.timestamp;
        if (e.timestamp > existing.lastSeen) existing.lastSeen = e.timestamp;
        if (SEVERITY_RANK[e.severity] > SEVERITY_RANK[existing.severity]) {
          existing.severity = e.severity;
        }
        existing.entries.push(e);
      } else {
        map.set(fp, {
          fingerprint: fp,
          severity: e.severity,
          category: e.category,
          source: e.source,
          message: e.message,
          count: 1,
          firstSeen: e.timestamp,
          lastSeen: e.timestamp,
          entries: [e],
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime(),
    );
  },

  pinnedEntries: () => {
    const { entries, pinnedIds } = get();
    return entries.filter((e) => pinnedIds.has(e.id));
  },

  traceEntries: (traceId) =>
    get().entries.filter((e) => e.traceId === traceId),

  countBySeverity: (sev) =>
    get().entries.filter((e) => e.severity === sev).length,

  countAbove: (min) =>
    get().entries.filter((e) => SEVERITY_RANK[e.severity] >= SEVERITY_RANK[min]).length,

  allTags: () =>
    [...new Set(get().entries.flatMap((e) => e.tags))].sort(),

  allTraceIds: () =>
    [...new Set(get().entries.map((e) => e.traceId).filter(Boolean) as string[])],

  currentRate: () => {
    const { rateBuckets } = get();
    if (rateBuckets.length === 0) return { errorsPerMin: 0, totalPerMin: 0 };
    const latest = rateBuckets[rateBuckets.length - 1];
    return { errorsPerMin: latest.errors, totalPerMin: latest.total };
  },
}));
