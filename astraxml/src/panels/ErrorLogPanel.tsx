/**
 * AstraXML — ErrorLogPanel
 *
 * A bottom-dock panel that displays the structured error/event log.
 *
 * Features
 * ────────
 * • Resizable via a drag handle on the top edge
 * • Severity filter pills  (All / Fatal / Error / Warn / Info / Debug)
 * • Category dropdown      (All + every LogCategory)
 * • Full-text search       (message · source · detail)
 * • Auto-scroll toggle     (follows newest entry)
 * • Per-row expand         (shows detail + context key-value table)
 * • Per-row copy           (copies formatted text to clipboard)
 * • Bulk export            (downloads entries as JSON)
 * • Clear                  (clears memory + SQLite via Tauri command)
 * • Absolute / relative timestamp toggle
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  useErrorLogStore,
  LogEntry,
  LogSeverity,
  LogCategory,
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

const SEV_LABEL: Record<LogSeverity, string> = {
  fatal: 'FAT',
  error: 'ERR',
  warn:  'WRN',
  info:  'INF',
  debug: 'DBG',
};

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 240;

import { isTauri } from '../lib/tauri';

// ── Helpers ───────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff <     60) return `${diff}s`;
  if (diff <   3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h`;
  return new Date(iso).toLocaleDateString();
}

function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour12: false });
}

function copyEntry(entry: LogEntry): void {
  const lines = [
    `[${entry.severity.toUpperCase()}] ${entry.timestamp}`,
    `Source:  ${entry.source}`,
    `Message: ${entry.message}`,
  ];
  if (entry.detail) lines.push('', 'Detail:', entry.detail);
  if (Object.keys(entry.context).length > 0) {
    lines.push('', 'Context:');
    for (const [k, v] of Object.entries(entry.context)) {
      lines.push(`  ${k}: ${v}`);
    }
  }
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
    setVisible,
    clear,
    setSeverityFilter,
    setCategoryFilter,
    setSearchQuery,
    setAutoScroll,
    filteredEntries,
    countBySeverity,
  } = useErrorLogStore();

  const [height,      setHeight]      = useState(DEFAULT_HEIGHT);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [relTime,     setRelTime]     = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Auto-scroll ─────────────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll && isVisible && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries.length, autoScroll, isVisible]);

  // ── Drag-resize ─────────────────────────────────────────────────────
  const onDragHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY      = e.clientY;
      const startHeight = height;

      const onMove = (me: MouseEvent) => {
        // Dragging up (negative delta) increases height.
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

  // ── Clear (also triggers Tauri backend clear) ────────────────────────
  const handleClear = useCallback(async () => {
    clear();
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('clear_error_log');
      } catch { /* best-effort */ }
    }
  }, [clear]);

  // ── Export ───────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const json = await invoke<string>('export_error_log');
        const parsed = JSON.parse(json) as LogEntry[];
        downloadJson(parsed);
        return;
      } catch { /* fall through to client-side export */ }
    }
    downloadJson(filteredEntries());
  }, [filteredEntries]);

  // ── Toggle expand ────────────────────────────────────────────────────
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ── Counts for pills ─────────────────────────────────────────────────
  const errorCount = countBySeverity('error') + countBySeverity('fatal');
  const warnCount  = countBySeverity('warn');
  const infoCount  = countBySeverity('info');

  const visible = filteredEntries();
  const totalCount = entries.length;

  if (!isVisible) return null;

  return (
    <div
      className="errlog"
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

        <div className="errlog__counts">
          {errorCount > 0 && (
            <span className="errlog__count errlog__count--error">{errorCount} err</span>
          )}
          {warnCount  > 0 && (
            <span className="errlog__count errlog__count--warn">{warnCount} warn</span>
          )}
          {infoCount  > 0 && (
            <span className="errlog__count errlog__count--info">{infoCount} info</span>
          )}
        </div>

        {sessionId && (
          <span className="errlog__session" title={`Session: ${sessionId}`}>
            sid: {sessionId.slice(0, 8)}
          </span>
        )}

        <div className="errlog__header-actions">
          <button
            className={`errlog__ctrl${relTime ? ' active' : ''}`}
            onClick={() => setRelTime((v) => !v)}
            title="Toggle relative / absolute timestamps"
          >
            {relTime ? 'rel' : 'abs'}
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
          <button className="errlog__ctrl errlog__ctrl--danger" onClick={handleClear} title="Clear all log entries">
            clear
          </button>
          <button className="errlog__ctrl errlog__ctrl--close" onClick={() => setVisible(false)} title="Close log">
            ✕
          </button>
        </div>
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
          placeholder="Search message, source, detail…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* ── Entry list ──────────────────────────────────────────── */}
      <div className="errlog__list" ref={listRef}>
        {visible.length === 0 ? (
          <div className="errlog__empty">
            {totalCount === 0
              ? 'No log entries yet.  Errors and events will appear here.'
              : 'No entries match the current filters.'}
          </div>
        ) : (
          visible.map((entry) => (
            <LogRow
              key={entry.id}
              entry={entry}
              expanded={expandedIds.has(entry.id)}
              relTime={relTime}
              onToggle={toggleExpand}
              onCopy={copyEntry}
            />
          ))
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <div className="errlog__footer">
        <span>
          Showing {visible.length.toLocaleString()} of {totalCount.toLocaleString()} entries
        </span>
        {totalCount >= 1000 && (
          <span className="errlog__footer--warn">&nbsp;(ring-buffer full)</span>
        )}
      </div>
    </div>
  );
}

// ── LogRow ────────────────────────────────────────────────────────────────

interface LogRowProps {
  entry:    LogEntry;
  expanded: boolean;
  relTime:  boolean;
  onToggle: (id: string) => void;
  onCopy:   (entry: LogEntry) => void;
}

function LogRow({ entry, expanded, relTime, onToggle, onCopy }: LogRowProps) {
  const hasDetail = !!entry.detail || Object.keys(entry.context).length > 0;

  return (
    <div className={`errlog__row errlog__row--${entry.severity}${expanded ? ' expanded' : ''}`}>
      {/* ── Summary line ────────────────────────────────────────── */}
      <div className="errlog__row-summary">
        <span className={`errlog__sev errlog__sev--${entry.severity}`}>
          {SEV_LABEL[entry.severity]}
        </span>
        <span className="errlog__ts" title={entry.timestamp}>
          {relTime ? relativeTime(entry.timestamp) : absoluteTime(entry.timestamp)}
        </span>
        <span className="errlog__cat">[{entry.category}]</span>
        <span className="errlog__src">{entry.source}</span>
        <span className="errlog__msg">{entry.message}</span>

        <div className="errlog__row-actions">
          {hasDetail && (
            <button
              className="errlog__row-btn"
              onClick={() => onToggle(entry.id)}
              title={expanded ? 'Collapse' : 'Expand detail'}
            >
              {expanded ? '▲' : '▼'}
            </button>
          )}
          <button
            className="errlog__row-btn"
            onClick={() => onCopy(entry)}
            title="Copy to clipboard"
          >
            ⎘
          </button>
        </div>
      </div>

      {/* ── Expanded detail ─────────────────────────────────────── */}
      {expanded && hasDetail && (
        <div className="errlog__detail">
          {entry.detail && (
            <pre className="errlog__detail-pre">{entry.detail}</pre>
          )}
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
        </div>
      )}
    </div>
  );
}
