# `store/` — State Management

> Zustand-powered global state for the entire AstraXML game-modding editor.

## Purpose

This directory contains Zustand stores that hold all application state — the loaded document, parsed XML nodes, UI state, and the structured error/event log. Zustand was chosen for its minimal API, React 19 compatibility, and excellent performance with large state trees (thousands of game config nodes).

---

## Files

### `app.ts` — Application Store (101 lines)

The primary state store for the editor. Holds everything related to the loaded game document and user interactions.

#### Types Defined

| Type | Description | Game Context |
|------|-------------|--------------|
| `XmlNode` | `{ id, doc_id, parent_id, node_type, name, value, depth, order_index }` | Each `<type>`, `<nominal>`, `<tag>` in a game config |
| `XmlAttribute` | `{ id, node_id, name, value }` | Attributes like `name="M4A1"`, `user="yes"` |
| `DocumentInfo` | `{ id, name, path, root_node_id }` | The loaded `.xml` file reference |
| `ViewMode` | `'table' \| 'tree' \| 'raw'` | Current editing view |
| `FilterCriteria` | `{ tagName, attribute, value, mode }` | Active filter state |
| `OpenDocumentResult` | `{ document, nodes, attributes }` | Full parse result from Rust |

#### State

| Field | Type | Description |
|-------|------|-------------|
| `document` | `DocumentInfo \| null` | Currently loaded game file |
| `nodes` | `XmlNode[]` | All parsed XML nodes (flat array) |
| `attributes` | `XmlAttribute[]` | All parsed attributes |
| `selectedNodeId` | `number \| null` | Currently selected node |
| `viewMode` | `ViewMode` | Active view (table/tree/raw) |
| `searchQuery` | `string` | Global search text |
| `isLoading` | `boolean` | Loading state indicator |
| `error` | `string \| null` | Last error message |
| `filter` | `FilterCriteria` | Active filter parameters |

#### Actions

| Action | Signature | What It Does |
|--------|-----------|--------------|
| `loadDocument` | `(path: string) → void` | Opens a game XML file: calls `open_document` via Tauri IPC, stores result |
| `selectNode` | `(id: number \| null) → void` | Sets the selected node (triggers DetailPanel update) |
| `setViewMode` | `(mode: ViewMode) → void` | Switches between Table/Tree/Raw views |
| `setFilter` | `(partial: Partial<FilterCriteria>) → void` | Merges filter criteria |
| `resetFilter` | `() → void` | Clears all filters |
| `reset` | `() → void` | Full state reset (document unloaded) |
| `addNodes` | `(nodes: XmlNode[]) → void` | Appends new nodes (after add/clone operations) |
| `removeNodes` | `(ids: number[]) → void` | Removes nodes by ID (after delete operations) |
| `updateNodeLocal` | `(id, name, value) → void` | Optimistic local update (before Tauri confirms) |

#### Game Modding Workflow

```
User clicks "Open" → loadDocument("C:/DayZ/types.xml")
  ↓
Tauri IPC: open_document → Rust parses XML → returns nodes + attributes
  ↓
Store updates: document, nodes, attributes populated
  ↓
Views re-render: TableView shows all <type> elements as rows
  ↓
User clicks a row → selectNode(42)
  ↓
DetailPanel shows node 42's attributes, enables editing
  ↓
User edits nominal value → Tauri IPC: set_attribute → updateNodeLocal()
```

---

### `errorLog.ts` — Error Log Store (241 lines)

A Zustand store managing a bounded ring-buffer of 5,000 structured log entries with filtering, grouping, and real-time rate tracking.

#### Types Defined

| Type | Description |
|------|-------------|
| `LogSeverity` | `'fatal' \| 'error' \| 'warn' \| 'info' \| 'debug'` |
| `LogCategory` | `'parse' \| 'db' \| 'io' \| 'validation' \| 'rule' \| 'snapshot' \| 'serialization' \| 'command' \| 'ui' \| 'unknown'` |
| `LogTab` | `'list' \| 'timeline' \| 'grouped' \| 'stats'` |
| `Breadcrumb` | `{ timestamp, label, data? }` — action history trail |
| `LogEntry` | 18-field structured log entry with trace correlation, fingerprinting, timing, breadcrumbs |
| `GroupedEntry` | Fingerprint-collapsed group: `{ fingerprint, message, severity, category, source, count, firstSeen, lastSeen, entries }` |
| `RateBucket` | `{ time, total, errors, warnings }` — per-minute error rate |

#### State (highlights)

| Field | Type | Purpose |
|-------|------|---------|
| `entries` | `LogEntry[]` | Ring-buffer (max 5,000) |
| `isVisible` | `boolean` | Panel open/closed |
| `severityFilter` | `LogSeverity \| 'all'` | Active severity filter |
| `categoryFilter` | `LogCategory \| 'all'` | Active category filter |
| `searchQuery` | `string` | Free-text search across message/source/detail/tags |
| `activeTab` | `LogTab` | Current error log view tab |
| `pinnedIds` | `Set<string>` | Pinned entry IDs |
| `traceFilter` | `string \| null` | Filter by trace ID |
| `rateBuckets` | `RateBucket[]` | Rolling rate data for sparkline |
| `newEntryPulse` | `LogSeverity \| null` | Triggers pulse animation |

#### Key Implementation Details

- **Ring-buffer**: `push()` uses `slice(-(MAX_ENTRIES - 1))` to enforce the 5,000 entry cap
- **Batch push**: `pushBatch()` appends all entries then slices, uses `batch.reduce(updateBuckets, ...)` for rate tracking
- **Rate buckets**: `updateBuckets()` maps over existing buckets, creating new minutes immutably
- **Fingerprint grouping**: `groupedEntries()` groups by `entry.fingerprint`, tracks count/firstSeen/lastSeen
- **Search**: `filteredEntries()` tests `[message, source, detail, ...tags].some(field => field.includes(query))`
- **Derived selectors**: `allTags()`, `allTraceIds()` use one-liner `[...new Set(entries.flatMap(...))]`

#### Severity Ranking

```typescript
const SEVERITY_RANK = { fatal: 5, error: 4, warn: 3, info: 2, debug: 1 };
```

Groups use the highest severity from their entries. The ranking influences sorting, coloring, and pulse animations.

---

## Why Zustand?

| Benefit | Application |
|---------|------------|
| **No providers needed** | Stores are imported directly — no wrapping `<Provider>` trees |
| **Selector-based re-renders** | Only components using changed state re-render |
| **Immer-free immutability** | Uses spread + slice patterns for updates |
| **Tiny bundle** | ~2KB — important for desktop app startup |
| **DevTools support** | Works with Redux DevTools for debugging |

---

## Game Modding Context

The app store directly represents the game modder's working document. When editing a DayZ `types.xml`, the `nodes` array might contain 5,000+ `XmlNode` entries — one for each `<type>`, `<nominal>`, `<min>`, `<max>`, `<lifetime>`, `<restock>`, `<category>`, `<tag>`, etc. The store's flat array structure (mirroring SQLite's flat table) enables:

- **Fast filtering** — `O(n)` scans with early termination
- **Efficient updates** — Update a single node by ID without cloning the entire tree
- **Sort stability** — `order_index` preserves original XML element ordering
