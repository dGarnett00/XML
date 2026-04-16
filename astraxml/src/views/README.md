# `views/` — Main Content Views

> Three specialized XML rendering modes optimized for different game-modding tasks.

## Purpose

Views occupy the central content area of the editor. Each view provides a different perspective on the same underlying XML data, optimized for specific editing tasks. Game modders switch between views depending on whether they need to bulk-edit values (Table), explore hierarchy (Tree), or verify output (Raw).

---

## Files

### `TableView.tsx` + `TableView.css` (664 + 232 lines)

**The workhorse view for game modders.** Renders top-level XML elements as spreadsheet-like rows with sortable, filterable, editable columns.

#### Architecture

```
TableView
├── Toolbar (batch-op buttons, column info)
├── <table>
│   ├── Header row (sortable columns)
│   ├── GroupRow × N (top-level elements)
│   │   └── ChildRow × M (nested children, shown when expanded)
│   └── Footer (node counts)
└── Auto-detected child columns
```

#### Components

**`GroupRow`** — Represents a top-level XML element (e.g., a `<type>` in `types.xml`):
- Name attribute displayed as the primary identifier
- Child count badge (e.g., "12 children")
- Attribute badges showing key values
- Expand/collapse toggle
- Editable cells for attribute values

**`ChildRow`** — Nested child elements shown when a group is expanded:
- Child element name
- Text value (editable via double-click)
- Displayed in slightly indented/alternate-colored rows

**`EditableCell`** — Double-click inline editor:
- Shows static text normally
- On double-click, transforms into an `<input>`
- On Enter/blur, commits the change via Tauri IPC
- On Escape, cancels the edit

#### Auto-Detected Child Columns

The table automatically scans all top-level elements to detect common child patterns. If >30% of items share a child element name (e.g., `nominal`, `min`, `lifetime`), that child becomes a dedicated sortable column. Up to 6 dynamic columns are detected. This means:

- For `types.xml`: columns for `nominal`, `min`, `lifetime`, `restock`, `quantmin`, `quantmax` appear automatically
- For `cfgspawnabletypes.xml`: columns for relevant child elements auto-detect
- The threshold prevents rarely-used children from cluttering the header

#### Sorting

Click any column header to sort. Supports:
- **String sort** — Alphabetical for names
- **Numeric-aware sort** — Detects number values and sorts numerically (so "2" < "10", not "10" < "2")
- **Tri-state** — Click cycles: ascending → descending → unsorted

#### Selection

| Action | Behavior |
|--------|----------|
| Click | Select single row |
| Ctrl+Click | Toggle row in multi-selection |
| Shift+Click | Range select from last click |
| Arrow Up/Down | Navigate rows |
| Space | Expand/collapse selected group |
| Delete | Delete selected node(s) |
| Arrow Left/Right | Collapse/expand |

#### Filtering

Respects the FilterBar criteria:
- **Tag name** — Matches against element names
- **Attribute** — Matches against attribute names
- **Value** — Matches against attribute values
- **Modes** — Contains (substring), Equals (exact), Regex (pattern match)

#### Batch Operations

When multiple rows are selected:
- **Clone** — Deep-copies all selected nodes (great for duplicating item templates)
- **Delete** — Removes all selected nodes with confirmation

#### Search Highlighting

When a global search query is active, matching text in any cell is wrapped in `<mark>` tags for visual emphasis.

---

### `TreeView.tsx` + `TreeView.css` (146 + 63 lines)

**Hierarchical XML explorer.** Shows the full document tree structure with expand/collapse, inline editing, and attribute display.

#### Architecture

```
TreeView
└── TreeNode (recursive)
    ├── Toggle arrow (▶/▼)
    ├── Element name (color-coded blue)
    ├── Inline attributes (gray, after name)
    ├── Inline text (for single-text-child elements)
    └── Children TreeNode × N (recursive)
```

#### Components

**`TreeNode`** — Recursive component rendering a single XML node:
- **Elements** — Blue name, clickable, expandable, with inline attribute display
- **Text nodes** — Green italic text content
- **Comments** — Gray italic `<!-- -->` display
- **Inline text** — If an element has exactly one text child, the text is shown inline rather than as a nested node (e.g., `<nominal>10</nominal>` shows as `nominal: 10`)

#### Inline Editing

Double-click on any element name to activate inline edit mode:
- Text input replaces the name
- Enter confirms → calls `update_node` via Tauri IPC
- Escape cancels

#### Performance Optimizations

Two memoized lookup maps rebuild only when `nodes` change:
- `childrenByParent` — `Map<parent_id | null, XmlNode[]>` sorted by `order_index`
- `attrsByNode` — `Map<node_id, XmlAttribute[]>` for quick attribute access

These maps prevent `O(n²)` lookups during recursive rendering of large documents.

#### Game Modding Usage

The tree view is essential for understanding deeply nested XML structures. In DayZ configs:

```xml
<type name="M4A1">
  <nominal>10</nominal>          ← TreeView shows all this
  <min>5</min>                     hierarchy clearly
  <lifetime>14400</lifetime>
  <category name="weapons"/>
  <tag name="shelves"/>
  <usage name="Military"/>
</type>
```

Modders use this view to:
- Verify correct nesting of elements
- Find misplaced child elements
- Understand the document structure before bulk editing in Table view

---

### `RawView.tsx` + `RawView.css` (119 + 40 lines)

**Syntax-highlighted raw XML display.** Shows the re-serialized XML output with line numbers and color coding.

#### Architecture

```
RawView
├── Toolbar (line count)
└── <pre> container
    └── HighlightedLine × N (line-numbered, color-coded)
```

#### Process

1. When the document or nodes change, `RawView` calls `serialize_document` via Tauri IPC
2. The Rust serializer rebuilds the XML string from the flat node/attribute data in SQLite
3. The result is split into lines and rendered with syntax highlighting

#### `syntaxHighlight()` Function

Splits the serialized XML into lines and returns an array of `{ lineNo, text }` objects.

#### `HighlightedLine` Component

Applies regex-based colorization to each line:

| Pattern | Color | Example |
|---------|-------|---------|
| `<tag>`, `</tag>`, `/>` | Blue (`--accent-blue`) | `<type>`, `</type>` |
| `attribute="..."` | Green/Yellow | `name="M4A1"` |
| `<!-- comment -->` | Gray (muted) | `<!-- Weapons section -->` |
| `<?xml ... ?>` | Purple | `<?xml version="1.0"?>` |
| Text content | Default | `10`, `14400` |

#### Line Numbers

Each line has a numbered gutter displayed in muted text, making it easy to reference specific lines during debugging or collaboration.

#### Game Modding Usage

The raw view is the **verification step** in the modding workflow:
1. Open `types.xml` in Table view
2. Make bulk edits (change all weapon nominals from 10 to 5)
3. Switch to Raw view to verify the XML output looks correct
4. Export the modified file

It's also useful for copying specific XML snippets to paste into game server configs or forum posts.

---

## View Comparison

| Feature | TableView | TreeView | RawView |
|---------|-----------|----------|---------|
| **Best for** | Bulk editing values | Understanding structure | Verifying output |
| **Edit mode** | Double-click cells | Double-click names | Read-only |
| **Multi-select** | ✅ Ctrl/Shift+Click | ❌ Single select | ❌ N/A |
| **Sorting** | ✅ Column headers | ❌ Document order | ❌ Document order |
| **Filtering** | ✅ Full filter bar | ❌ Shows all nodes | ❌ Shows full XML |
| **Batch ops** | ✅ Clone/Delete | ❌ | ❌ |
| **Search highlight** | ✅ `<mark>` tags | ❌ | ❌ |
| **Line numbers** | ❌ | ❌ | ✅ |
| **Performance** | Fast (flat rows) | Good (memoized maps) | Slower (re-serialize) |
