/**
 * AstraXML — ErrorLogPanel  (v2 — Revolutionary Overhaul)
 *
 * A bottom-dock panel with:
 *
 *   • Tabbed views       — List / Timeline / Grouped / Stats
 *   • Sparkline chart    — real-time error rate visualization
 *   • Fingerprint groups — auto-collapse repeated errors with occurrence count
 *   • Breadcrumb trails  — action history in expanded entries
 *   • Performance timing — duration badges for timed operations
 *   • Trace correlation  — click traceId to see all related entries
 *   • Pinned entries     — pin important entries for investigation
 *   • Keyboard shortcuts — Ctrl+L toggle, Ctrl+K clear
 *   • Copy-as-markdown   — formatted clipboard export
 *   • Animated pulse     — header pulses on new fatal/error
 *   • Live rate counter  — errors/min display
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  useErrorLogStore,
  LogEntry,
  LogSeverity,
  LogCategory,
  LogTab,
  GroupedEntry,
  SEVERITY_RANK,
} from '../store/errorLog';
import './ErrorLogPanel.css';

// ── Constants ─────────────────────────────────────────────────────────────

const SEVERITY_PILLS: Array<{ label: string; value: LogSeverity | 'all' }> = [
  { label: 'All',   value: 'all'   },
  { label: 'Fatal', value: 'fatal' },
  { label: 'Error', value: 'error' },
  { label: 'Warn',  value: 'warn'  },
  { label: 'Info',  value: 'info'  },
  { label: 'Debug', value: 'debug' },
];

const CATEGORIES: Array<{ label: string; value: LogCategory | 'all' }> = [
  { label: 'All categories', value: 'all'           },
  { label: 'Parse',          value: 'parse'         },
  { label: 'Database',       value: 'db'            },
  { label: 'I/O',            value: 'io'            },
  { label: 'Validation',     value: 'validation'    },
  { label: 'Rule Engine',    value: 'rule'          },
  { label: 'Snapshot',       value: 'snapshot'      },
  { label: 'Serialization',  value: 'serialization' },
  { label: 'Command',        value: 'command'       },
  { label: 'UI',             value: 'ui'            },
  { label: 'Unknown',        value: 'unknown'       },
];

const TABS: Array<{ label: string; value: LogTab; icon: string }> = [
  { label: 'List',     value: 'list',     icon: '☰' },
  { label: 'Timeline', value: 'timeline', icon: '⏱' },
  { label: 'Grouped',  value: 'grouped',  icon: '▦' },
  { label: 'Stats',    value: 'stats',    icon: '◔' },
];

const SEV_LABEL: Record<LogSeverity, string> = {
  fatal: 'FAT',
  error: 'ERR',
  warn:  'WRN',
  info:  'INF',
  debug: 'DBG',
};

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 280;

import { isTauri } from '../lib/tauri';

// ── Helpers ───────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5)      return 'just now';
  if (diff <     60) return `${diff}s ago`;
  if (diff <   3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  } as Intl.DateTimeFormatOptions);
}

function formatDuration(ms: number): string {
  if (ms < 1)    return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function copyEntry(entry: LogEntry): void {
  const lines = [
    `[${entry.severity.toUpperCase()}] ${entry.timestamp}`,
    `Source:  ${entry.source}`,
    `Message: ${entry.message}`,
  ];
  if (entry.traceId) lines.push(`Trace:   ${entry.traceId}`);
  if (entry.durationMs != null) lines.push(`Duration: ${formatDuration(entry.durationMs)}`);
  if (entry.detail) lines.push('', 'Detail:', entry.detail);
  if (entry.tags.length > 0) lines.push(`Tags: ${entry.tags.join(', ')}`);
  if (Object.keys(entry.context).length > 0) {
    lines.push('', 'Context:');
    for (const [k, v] of Object.entries(entry.context)) {
      lines.push(`  ${k}: ${v}`);
    }
  }
  if (entry.breadcrumbs.length > 0) {
    lines.push('', 'Breadcrumbs:');
    for (const bc of entry.breadcrumbs) {
      lines.push(`  ${bc.timestamp} — ${bc.label}${bc.data ? ` (${bc.data})` : ''}`);
    }
  }
  navigator.clipboard.writeText(lines.join('\n')).catch(() => undefined);
}

function copyAsMarkdown(entry: LogEntry): void {
  const lines = [
    `### \`[${entry.severity.toUpperCase()}]\` ${entry.message}`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Timestamp | \`${entry.timestamp}\` |`,
    `| Source | \`${entry.source}\` |`,
    `| Category | \`${entry.category}\` |`,
  ];
  if (entry.traceId) lines.push(`| Trace ID | \`${entry.traceId}\` |`);
  if (entry.durationMs != null) lines.push(`| Duration | \`${formatDuration(entry.durationMs)}\` |`);
  if (entry.detail) lines.push('', '```', entry.detail, '```');
  navigator.clipboard.writeText(lines.join('\n')).catch(() => undefined);
}

function downloadJson(entries: LogEntry[]): void {
  const blob = new Blob([JSON.stringify(entries, null, 2)], {
    type: 'application/json',
  });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = `astraxml-log-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Sparkline ─────────────────────────────────────────────────────────────

function Sparkline({ data, width = 120, height = 24 }: {
  data: number[];
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const step = width / (data.length - 1);
  const points = data
    .map((v, i) => `${i * step},${height - (v / max) * (height - 2)}`)
    .join(' ');
  const fillPoints = `0,${height} ${points} ${(data.length - 1) * step},${height}`;

  return (
    <svg className="errlog__sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polygon points={fillPoints} fill="rgba(255,77,106,0.15)" />
      <polyline points={points} fill="none" stroke="var(--accent-red)" strokeWidth="1.5" />
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────

export function ErrorLogPanel() {
  const {
    entries,
    isVisible,
    autoScroll,
    severityFilter,
    categoryFilter,
    searchQuery,
    sessionId,
    activeTab,
    pinnedIds,
    traceFilter,
    rateBuckets,
    newEntryPulse,
    setVisible,
    clear,
    setSeverityFilter,
    setCategoryFilter,
    setSearchQuery,
    setAutoScroll,
    setActiveTab,
    togglePin,
    setTraceFilter,
    clearPulse,
    filteredEntries,
    groupedEntries,
    pinnedEntries,
    countBySeverity,
    currentRate,
  } = useErrorLogStore();

  const [height,      setHeight]      = useState(DEFAULT_HEIGHT);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [relTime,     setRelTime]     = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        useErrorLogStore.getState().toggleVisible();
      }
      if (e.ctrlKey && e.key === 'k' && isVisible) {
        e.preventDefault();
        handleClear();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isVisible]);

  // ── Auto-scroll ─────────────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll && isVisible && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries.length, autoScroll, isVisible]);

  // ── Pulse animation reset ──────────────────────────────────────────
  useEffect(() => {
    if (newEntryPulse) {
      const timer = setTimeout(() => clearPulse(), 2000);
      return () => clearTimeout(timer);
    }
  }, [newEntryPulse, clearPulse]);

  // ── Drag-resize ─────────────────────────────────────────────────────
  const onDragHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY      = e.clientY;
      const startHeight = height;

      const onMove = (me: MouseEvent) => {
        const delta     = startY - me.clientY;
        const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + delta));
        setHeight(newHeight);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    },
    [height]
  );

  // ── Clear ───────────────────────────────────────────────────────────
  const handleClear = useCallback(async () => {
    clear();
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('clear_error_log');
      } catch { /* best-effort */ }
    }
  }, [clear]);

  // ── Export ──────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const json = await invoke<string>('export_error_log');
        const parsed = JSON.parse(json) as LogEntry[];
        downloadJson(parsed);
        return;
      } catch { /* fall through */ }
    }
    downloadJson(filteredEntries());
  }, [filteredEntries]);

  // ── Toggle expand ──────────────────────────────────────────────────
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ── Counts ─────────────────────────────────────────────────────────
  const errorCount  = countBySeverity('error') + countBySeverity('fatal');
  const warnCount   = countBySeverity('warn');
  const infoCount   = countBySeverity('info');
  const rate        = currentRate();
  const pinned      = pinnedEntries();

  const visible     = filteredEntries();
  const grouped     = groupedEntries();
  const totalCount  = entries.length;

  // Sparkline data from rate buckets
  const sparkData = useMemo(
    () => rateBuckets.map((b) => b.errors),
    [rateBuckets],
  );

  if (!isVisible) return null;

  return (
    <div
      className={`errlog${newEntryPulse ? ` errlog--pulse-${newEntryPulse}` : ''}`}
      style={{ height }}
      role="complementary"
      aria-label="Error Log"
    >
      {/* ── Drag handle ─────────────────────────────────────────── */}
      <div
        className="errlog__drag"
        onMouseDown={onDragHandleMouseDown}
        title="Drag to resize"
      />

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="errlog__header">
        <span className="errlog__title">Error Log</span>

        {/* Severity badges */}
        <div className="errlog__counts">
          {errorCount > 0 && (
            <span className="errlog__count errlog__count--error">{errorCount} err</span>
          )}
          {warnCount > 0 && (
            <span className="errlog__count errlog__count--warn">{warnCount} warn</span>
          )}
          {infoCount > 0 && (
            <span className="errlog__count errlog__count--info">{infoCount} info</span>
          )}
        </div>

        {/* Rate counter */}
        {rate.errorsPerMin > 0 && (
          <span className="errlog__rate" title="Errors per minute">
            {rate.errorsPerMin}/min
          </span>
        )}

        {/* Sparkline */}
        <Sparkline data={sparkData} />

        {/* Session ID */}
        {sessionId && (
          <span className="errlog__session" title={`Session: ${sessionId}`}>
            sid:{sessionId.slice(0, 8)}
          </span>
        )}

        {/* Trace filter indicator */}
        {traceFilter && (
          <button
            className="errlog__trace-badge"
            onClick={() => setTraceFilter(null)}
            title="Clear trace filter"
          >
            trace:{traceFilter.slice(0, 8)}… ✕
          </button>
        )}

        <div className="errlog__header-actions">
          <button
            className={`errlog__ctrl${relTime ? ' active' : ''}`}
            onClick={() => setRelTime((v) => !v)}
            title="Toggle relative / absolute timestamps"
          >
            {relTime ? '⏱ rel' : '⏱ abs'}
          </button>
          <button
            className={`errlog__ctrl${autoScroll ? ' active' : ''}`}
            onClick={() => setAutoScroll(!autoScroll)}
            title="Toggle auto-scroll"
          >
            ↓ auto
          </button>
          <button className="errlog__ctrl" onClick={handleExport} title="Export log as JSON">
            ↓ JSON
          </button>
          <button className="errlog__ctrl errlog__ctrl--danger" onClick={handleClear} title="Clear all (Ctrl+K)">
            clear
          </button>
          <button className="errlog__ctrl errlog__ctrl--close" onClick={() => setVisible(false)} title="Close (Ctrl+L)">
            ✕
          </button>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────── */}
      <div className="errlog__tabs">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            className={`errlog__tab${activeTab === tab.value ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.value)}
          >
            <span className="errlog__tab-icon">{tab.icon}</span>
            {tab.label}
          </button>
        ))}

        {/* Pinned count */}
        {pinned.length > 0 && (
          <span className="errlog__pin-count" title="Pinned entries">
            📌 {pinned.length}
          </span>
        )}
      </div>

      {/* ── Filter bar ──────────────────────────────────────────── */}
      <div className="errlog__filters">
        <div className="errlog__pills">
          {SEVERITY_PILLS.map((p) => (
            <button
              key={p.value}
              className={`errlog__pill errlog__pill--${p.value}${severityFilter === p.value ? ' active' : ''}`}
              onClick={() => setSeverityFilter(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <select
          className="errlog__cat-select"
          title="Filter by category"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as LogCategory | 'all')}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>

        <input
          className="errlog__search"
          type="text"
          placeholder="Search message, source, detail, tags…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* ── Tab content ─────────────────────────────────────────── */}
      <div className="errlog__list" ref={listRef}>
        {activeTab === 'list' && (
          <ListView
            entries={visible}
            pinnedIds={pinnedIds}
            expandedIds={expandedIds}
            relTime={relTime}
            onToggle={toggleExpand}
            onCopy={copyEntry}
            onCopyMarkdown={copyAsMarkdown}
            onTogglePin={togglePin}
            onTraceFilter={setTraceFilter}
            totalCount={totalCount}
          />
        )}
        {activeTab === 'timeline' && (
          <TimelineView
            entries={visible}
            relTime={relTime}
          />
        )}
        {activeTab === 'grouped' && (
          <GroupedView
            groups={grouped}
            expandedIds={expandedIds}
            relTime={relTime}
            onToggle={toggleExpand}
            onCopy={copyEntry}
          />
        )}
        {activeTab === 'stats' && (
          <StatsView entries={entries} rateBuckets={rateBuckets} />
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <div className="errlog__footer">
        <span>
          {activeTab === 'grouped'
            ? `${grouped.length} groups from ${visible.length} entries`
            : `Showing ${visible.length.toLocaleString()} of ${totalCount.toLocaleString()} entries`}
        </span>
        {totalCount >= 5000 && (
          <span className="errlog__footer--warn">&nbsp;(ring-buffer full)</span>
        )}
        <span className="errlog__footer-shortcut">Ctrl+L toggle · Ctrl+K clear</span>
      </div>
    </div>
  );
}

// ── ListView ─────────────────────────────────────────────────────────────

interface ListViewProps {
  entries: LogEntry[];
  pinnedIds: Set<string>;
  expandedIds: Set<string>;
  relTime: boolean;
  onToggle: (id: string) => void;
  onCopy: (entry: LogEntry) => void;
  onCopyMarkdown: (entry: LogEntry) => void;
  onTogglePin: (id: string) => void;
  onTraceFilter: (traceId: string | null) => void;
  totalCount: number;
}

function ListView({
  entries, pinnedIds, expandedIds, relTime,
  onToggle, onCopy, onCopyMarkdown, onTogglePin, onTraceFilter, totalCount,
}: ListViewProps) {
  if (entries.length === 0) {
    return (
      <div className="errlog__empty">
        {totalCount === 0
          ? 'No log entries yet. Errors and events will appear here.'
          : 'No entries match the current filters.'}
      </div>
    );
  }

  return (
    <>
      {entries.map((entry) => (
        <LogRow
          key={entry.id}
          entry={entry}
          expanded={expandedIds.has(entry.id)}
          pinned={pinnedIds.has(entry.id)}
          relTime={relTime}
          onToggle={onToggle}
          onCopy={onCopy}
          onCopyMarkdown={onCopyMarkdown}
          onTogglePin={onTogglePin}
          onTraceFilter={onTraceFilter}
        />
      ))}
    </>
  );
}

// ── TimelineView ─────────────────────────────────────────────────────────

function TimelineView({ entries, relTime }: { entries: LogEntry[]; relTime: boolean }) {
  if (entries.length === 0) {
    return <div className="errlog__empty">No entries for timeline.</div>;
  }

  return (
    <div className="errlog__timeline">
      {entries.map((entry, i) => (
        <div key={entry.id} className={`errlog__tl-item errlog__tl-item--${entry.severity}`}>
          <div className="errlog__tl-line">
            <div className="errlog__tl-dot" />
            {i < entries.length - 1 && <div className="errlog__tl-connector" />}
          </div>
          <div className="errlog__tl-content">
            <div className="errlog__tl-header">
              <span className={`errlog__sev errlog__sev--${entry.severity}`}>
                {SEV_LABEL[entry.severity]}
              </span>
              <span className="errlog__tl-ts">
                {relTime ? relativeTime(entry.timestamp) : absoluteTime(entry.timestamp)}
              </span>
              {entry.durationMs != null && (
                <span className="errlog__duration">{formatDuration(entry.durationMs)}</span>
              )}
              <span className="errlog__cat">[{entry.category}]</span>
            </div>
            <div className="errlog__tl-msg">{entry.message}</div>
            <div className="errlog__tl-src">{entry.source}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── GroupedView ───────────────────────────────────────────────────────────

function GroupedView({ groups, expandedIds, relTime, onToggle, onCopy }: {
  groups: GroupedEntry[];
  expandedIds: Set<string>;
  relTime: boolean;
  onToggle: (id: string) => void;
  onCopy: (entry: LogEntry) => void;
}) {
  if (groups.length === 0) {
    return <div className="errlog__empty">No grouped entries.</div>;
  }

  return (
    <>
      {groups.map((group) => {
        const isExpanded = expandedIds.has(group.fingerprint);
        return (
          <div key={group.fingerprint} className={`errlog__group errlog__group--${group.severity}`}>
            <div
              className="errlog__group-header"
              onClick={() => onToggle(group.fingerprint)}
            >
              <span className={`errlog__sev errlog__sev--${group.severity}`}>
                {SEV_LABEL[group.severity]}
              </span>
              <span className="errlog__group-count">{group.count}×</span>
              <span className="errlog__cat">[{group.category}]</span>
              <span className="errlog__src">{group.source}</span>
              <span className="errlog__msg">{group.message}</span>
              <span className="errlog__group-range">
                {relTime
                  ? `${relativeTime(group.firstSeen)} — ${relativeTime(group.lastSeen)}`
                  : `${absoluteTime(group.firstSeen)} — ${absoluteTime(group.lastSeen)}`}
              </span>
              <span className="errlog__group-toggle">{isExpanded ? '▲' : '▼'}</span>
            </div>
            {isExpanded && (
              <div className="errlog__group-entries">
                {group.entries.map((entry) => (
                  <div key={entry.id} className="errlog__group-entry">
                    <span className="errlog__ts">
                      {relTime ? relativeTime(entry.timestamp) : absoluteTime(entry.timestamp)}
                    </span>
                    <span className="errlog__msg">{entry.message}</span>
                    <button className="errlog__row-btn" onClick={() => onCopy(entry)} title="Copy">⎘</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ── StatsView ────────────────────────────────────────────────────────────

function StatsView({ entries, rateBuckets }: {
  entries: LogEntry[];
  rateBuckets: { time: string; total: number; errors: number; warnings: number }[];
}) {
  const sevCounts = useMemo(() => {
    const counts: Record<LogSeverity, number> = { fatal: 0, error: 0, warn: 0, info: 0, debug: 0 };
    for (const e of entries) counts[e.severity]++;
    return counts;
  }, [entries]);

  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) {
      counts[e.category] = (counts[e.category] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const topSources = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) {
      if (SEVERITY_RANK[e.severity] >= SEVERITY_RANK.error) {
        counts[e.source] = (counts[e.source] || 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [entries]);

  const avgDuration = useMemo(() => {
    const timed = entries.filter((e) => e.durationMs != null);
    if (timed.length === 0) return null;
    const sum = timed.reduce((acc, e) => acc + (e.durationMs ?? 0), 0);
    return sum / timed.length;
  }, [entries]);

  return (
    <div className="errlog__stats">
      {/* Severity breakdown */}
      <div className="errlog__stats-section">
        <h4 className="errlog__stats-heading">Severity Breakdown</h4>
        <div className="errlog__stats-bars">
          {(Object.entries(sevCounts) as [LogSeverity, number][]).map(([sev, count]) => {
            const max = Math.max(...Object.values(sevCounts), 1);
            return (
              <div key={sev} className="errlog__stats-bar-row">
                <span className={`errlog__stats-label errlog__sev--${sev}`}>{sev}</span>
                <div className="errlog__stats-bar-track">
                  <div
                    className={`errlog__stats-bar-fill errlog__stats-bar--${sev}`}
                    style={{ width: `${(count / max) * 100}%` }}
                  />
                </div>
                <span className="errlog__stats-value">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Category breakdown */}
      <div className="errlog__stats-section">
        <h4 className="errlog__stats-heading">Categories</h4>
        <div className="errlog__stats-grid">
          {catCounts.map(([cat, count]) => (
            <div key={cat} className="errlog__stats-chip">
              <span className="errlog__stats-chip-label">{cat}</span>
              <span className="errlog__stats-chip-value">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Top error sources */}
      {topSources.length > 0 && (
        <div className="errlog__stats-section">
          <h4 className="errlog__stats-heading">Top Error Sources</h4>
          <div className="errlog__stats-list">
            {topSources.map(([src, count]) => (
              <div key={src} className="errlog__stats-list-item">
                <span className="errlog__stats-list-src">{src}</span>
                <span className="errlog__stats-list-count">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Performance */}
      {avgDuration != null && (
        <div className="errlog__stats-section">
          <h4 className="errlog__stats-heading">Performance</h4>
          <div className="errlog__stats-metric">
            <span>Avg operation duration</span>
            <span className="errlog__stats-metric-value">{formatDuration(avgDuration)}</span>
          </div>
        </div>
      )}

      {/* Rate chart */}
      {rateBuckets.length > 1 && (
        <div className="errlog__stats-section">
          <h4 className="errlog__stats-heading">Error Rate (last 30 min)</h4>
          <Sparkline data={rateBuckets.map((b) => b.errors)} width={300} height={40} />
        </div>
      )}
    </div>
  );
}

// ── LogRow ────────────────────────────────────────────────────────────────

interface LogRowProps {
  entry:         LogEntry;
  expanded:      boolean;
  pinned:        boolean;
  relTime:       boolean;
  onToggle:      (id: string) => void;
  onCopy:        (entry: LogEntry) => void;
  onCopyMarkdown:(entry: LogEntry) => void;
  onTogglePin:   (id: string) => void;
  onTraceFilter: (traceId: string | null) => void;
}

function LogRow({
  entry, expanded, pinned, relTime,
  onToggle, onCopy, onCopyMarkdown, onTogglePin, onTraceFilter,
}: LogRowProps) {
  const hasDetail = !!entry.detail || Object.keys(entry.context).length > 0
    || entry.breadcrumbs.length > 0 || entry.tags.length > 0;

  return (
    <div className={`errlog__row errlog__row--${entry.severity}${expanded ? ' expanded' : ''}${pinned ? ' pinned' : ''}`}>
      {/* ── Summary line ────────────────────────────────────────── */}
      <div className="errlog__row-summary">
        <span className={`errlog__sev errlog__sev--${entry.severity}`}>
          {SEV_LABEL[entry.severity]}
        </span>
        <span className="errlog__ts" title={entry.timestamp}>
          {relTime ? relativeTime(entry.timestamp) : absoluteTime(entry.timestamp)}
        </span>
        {entry.durationMs != null && (
          <span className="errlog__duration" title={`${entry.durationMs}ms`}>
            {formatDuration(entry.durationMs)}
          </span>
        )}
        <span className="errlog__cat">[{entry.category}]</span>
        <span className="errlog__src">{entry.source}</span>
        <span className="errlog__msg">{entry.message}</span>

        {/* Tags */}
        {entry.tags.length > 0 && (
          <div className="errlog__tags">
            {entry.tags.map((t) => (
              <span key={t} className="errlog__tag">{t}</span>
            ))}
          </div>
        )}

        <div className="errlog__row-actions">
          {entry.traceId && (
            <button
              className="errlog__row-btn errlog__row-btn--trace"
              onClick={() => onTraceFilter(entry.traceId)}
              title={`Filter by trace: ${entry.traceId}`}
            >
              ⛓
            </button>
          )}
          <button
            className={`errlog__row-btn${pinned ? ' active' : ''}`}
            onClick={() => onTogglePin(entry.id)}
            title={pinned ? 'Unpin' : 'Pin entry'}
          >
            📌
          </button>
          {hasDetail && (
            <button
              className="errlog__row-btn"
              onClick={() => onToggle(entry.id)}
              title={expanded ? 'Collapse' : 'Expand detail'}
            >
              {expanded ? '▲' : '▼'}
            </button>
          )}
          <button className="errlog__row-btn" onClick={() => onCopy(entry)} title="Copy">
            ⎘
          </button>
          <button className="errlog__row-btn" onClick={() => onCopyMarkdown(entry)} title="Copy as Markdown">
            M↓
          </button>
        </div>
      </div>

      {/* ── Expanded detail ─────────────────────────────────────── */}
      {expanded && hasDetail && (
        <div className="errlog__detail">
          {/* Trace info */}
          {(entry.traceId || entry.spanId) && (
            <div className="errlog__detail-trace">
              {entry.traceId && <span>Trace: <code>{entry.traceId}</code></span>}
              {entry.spanId && <span>Span: <code>{entry.spanId}</code></span>}
              {entry.fingerprint && <span>Fingerprint: <code>{entry.fingerprint}</code></span>}
            </div>
          )}

          {/* Detail/stack trace */}
          {entry.detail && (
            <pre className="errlog__detail-pre">{entry.detail}</pre>
          )}

          {/* Context table */}
          {Object.keys(entry.context).length > 0 && (
            <table className="errlog__ctx-table">
              <tbody>
                {Object.entries(entry.context).map(([k, v]) => (
                  <tr key={k}>
                    <td className="errlog__ctx-key">{k}</td>
                    <td className="errlog__ctx-val">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Breadcrumbs */}
          {entry.breadcrumbs.length > 0 && (
            <div className="errlog__breadcrumbs">
              <div className="errlog__breadcrumbs-title">Breadcrumb Trail</div>
              {entry.breadcrumbs.map((bc, i) => (
                <div key={i} className="errlog__breadcrumb">
                  <span className="errlog__breadcrumb-ts">{absoluteTime(bc.timestamp)}</span>
                  <span className="errlog__breadcrumb-label">{bc.label}</span>
                  {bc.data && <span className="errlog__breadcrumb-data">{bc.data}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Tags */}
          {entry.tags.length > 0 && (
            <div className="errlog__detail-tags">
              {entry.tags.map((t) => (
                <span key={t} className="errlog__tag">{t}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
