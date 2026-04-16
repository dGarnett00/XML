# `panels/` — UI Shell Components

> The structural chrome of the AstraXML editor — toolbar, filters, detail inspector, status bar, and error log.

## Purpose

Panels form the **shell** of the editor UI. They surround the main content views (Table/Tree/Raw) and provide navigation, actions, contextual editing, status information, and diagnostic logging. Together, these panels give game modders full control over their XML editing workflow.

---

## Files

### `Toolbar.tsx` + `Toolbar.css` (106 + 99 lines)

The top-level header bar. The primary entry point for all editor actions.

**Components:**
- **Brand area** — Logo + "AstraXML" title + currently open file name + "Offline" badge
- **Global search** — Text input that sets `searchQuery` in the app store, used for highlighting/filtering
- **View mode toggle** — Three pill buttons: Table / Tree / Raw. Controls which view renders in the main area
- **Action buttons:**
  - **Open** — Calls `openFileDialog()` → `loadDocument()` to load a game XML file
  - **Save** — Invokes `export_document` command to write modified XML back to disk
  - **Export** — Same as Save but prompts for a new file path
  - **Bulk Edit** — Placeholder for the rules engine UI (mass-edit game item properties)
  - **Error Log toggle** — Badge showing error/warning count, toggles the Error Log Panel

**Game modding workflow:** A modder opens a `types.xml`, sees the file name in the toolbar, uses search to find specific items (e.g., "M4A1"), switches between Table view (for bulk editing) and Raw view (to verify output), then saves.

---

### `FilterBar.tsx` + `FilterBar.css` (63 + 64 lines)

An optional filter row that appears below the toolbar when a document is loaded.

**Filter fields:**
- **Tag name** — Filter by XML element name (e.g., `type`, `cargo`, `attachments`)
- **Attribute** — Filter by attribute name (e.g., `name`, `user`)
- **Value** — Filter by attribute value (e.g., `weapons`, `AKM`)
- **Mode toggle** — Contains / Equals / Regex matching modes
- **Clear button** — Resets all filters

**Game modding usage:** When editing `types.xml` with 1000+ item types, modders can filter to just `<type name="...">` elements, or find all items where `category name="weapons"`. The regex mode allows power users to match patterns like `^AK.*` for all AK-variant weapons.

---

### `DetailPanel.tsx` + `DetailPanel.css` (152 + 99 lines)

The right sidebar showing detailed information about the currently selected XML node.

**Sections:**
- **Node info** — Element name, node type (element/text/comment), depth level, text value
- **Inline edit form** — Double-click to edit the node's name and value directly
- **Attribute list** — All attributes rendered as `name = value` pairs
- **Action buttons:**
  - **Edit** — Activates inline editing mode
  - **+ Child** — Adds a new child element (e.g., adding a `<tag>` inside a `<type>`)
  - **Clone** — Deep-copies the node and all children/attributes (great for duplicating game items)
  - **Delete** — Recursively removes the node and all descendants

**Game modding usage:** Select an item type in the table → see all its attributes in the Detail Panel → edit `nominal`, `min`, `lifetime` values → add new child elements like `<tag name="shelves">` → clone entire items as templates for new weapons.

**Tauri commands used:**
| Action | Command | Description |
|--------|---------|-------------|
| Edit | `update_node` | Updates node name/value in SQLite |
| Add child | `add_node` | Inserts a new child element |
| Clone | `clone_node` | Deep BFS clone with all attributes |
| Delete | `delete_node` | Recursive BFS deletion |

---

### `StatusBar.tsx` + `StatusBar.css` (42 + 23 lines)

A 28px-tall footer bar at the bottom of the editor.

**Displays:**
- **Offline indicator** — Shows when running without network
- **Node count** — Total number of XML nodes in the document (e.g., "3,847 nodes")
- **Selected node** — Name of the currently selected node
- **Loading spinner** — Animated dot when operations are in progress
- **Error text** — Last error message
- **Error count button** — Opens the Error Log Panel
- **Version label** — "AstraXML v0.1.0"

**Game modding usage:** When loading a large `types.xml` (5000+ items), the node count gives immediate feedback on document size. The loading spinner indicates when parsing is still in progress.

---

### `ErrorLogPanel.tsx` + `ErrorLogPanel.css` (905 + 854 lines)

The largest and most complex panel. A bottom-dock diagnostic panel with four tabbed views.

**Tabs:**

| Tab | View | Purpose |
|-----|------|---------|
| **List** | `ListView` | Chronological log entries with expandable details |
| **Timeline** | `TimelineView` | Vertical timeline with connector lines |
| **Grouped** | `GroupedView` | Entries collapsed by fingerprint with occurrence counts |
| **Stats** | `StatsView` | Severity bars, category chips, top error sources, performance metrics |

**Key features:**
- **Sparkline SVG** — Real-time error rate visualization in the header
- **Severity pills** — Filter by Fatal/Error/Warn/Info/Debug
- **Category select** — Filter by Parse/DB/IO/Validation/Rule/etc.
- **Text search** — Search across message, source, detail, and tags
- **Drag-resize** — Mouse drag on the top edge (120px–600px range)
- **Keyboard shortcuts** — `Ctrl+L` toggle visibility, `Ctrl+K` clear all
- **Pin entries** — Pin important entries for investigation
- **Trace correlation** — Click a traceId to see all related entries
- **Copy / Copy as Markdown** — Clipboard export for bug reports
- **JSON export** — Download filtered entries as `.json`
- **Auto-scroll** — Follows new entries in real-time
- **Pulse animation** — Header pulses red/orange on new fatal/error entries

**Sub-components:**
- `Sparkline` — SVG polyline/polygon chart from rate bucket data
- `ListView` — Maps entries to `LogRow` components
- `LogRow` — Single log entry with expandable detail (stack trace, context table, breadcrumb trail, tags)
- `TimelineView` — Vertical timeline with dot connectors and severity coloring
- `GroupedView` — Fingerprint-grouped entries with count badges and time ranges
- `StatsView` — Dashboard with severity breakdown bars, category grid, top error sources, average duration, rate chart

**Game modding context:** When parsing a malformed game config, the Error Log Panel shows exactly what went wrong. Parse errors are grouped by fingerprint so repeated issues (e.g., 50 items missing closing tags) show as a single group with a "50×" badge. The trace correlation lets modders see all errors from a single file-open operation together.

---

## Layout Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                          Toolbar                                   │
├────────────────────────────────────────────────────────────────────┤
│                          FilterBar                                 │
├──────────────────────────────────────────┬─────────────────────────┤
│                                          │                         │
│           Main View Area                 │     DetailPanel         │
│   (TableView / TreeView / RawView)       │     (right sidebar)     │
│                                          │                         │
├──────────────────────────────────────────┴─────────────────────────┤
│                       ErrorLogPanel (bottom dock)                  │
├────────────────────────────────────────────────────────────────────┤
│                          StatusBar                                 │
└────────────────────────────────────────────────────────────────────┘
```
