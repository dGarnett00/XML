# `app/` — Application Logic Layer

> High-level orchestration of editor operations: document loading, search, bulk editing, and macro recording.

## Purpose

The `app/` directory sits between the Tauri command handlers (`commands.rs`) and the core engines (`core/`). It contains application-level business logic that composes multiple core operations into cohesive workflows. Each module corresponds to a major feature area of the game-modding editor.

---

## Files

### `mod.rs` (4 lines)

Module declarations exposing the four sub-modules:
```rust
pub mod editor;
pub mod search;
pub mod rules;
pub mod macros;
```

---

### `editor.rs` — Document Controller (104 lines)

Orchestrates the process of opening a game XML file and converting it into queryable, editable data.

#### `open_document(path: &str, conn: &Connection) → Result<(Document, Vec<XmlNode>, Vec<Attribute>)>`

**The most critical function in the entire application.** Called when a modder opens a game config file.

**Process:**
1. **Read file** — `fs::read_to_string(path)` loads the XML file from disk
2. **Parse XML** — Calls `core::xml::parser::parse()` with a `BufReader` for streaming parse
3. **Begin transaction** — Opens a SQLite transaction for atomic insertion
4. **Insert document** — Creates a row in `documents` table with file name and path
5. **Insert nodes** — Bulk inserts all parsed `XmlNode` entries into `xml_nodes` table
6. **Insert attributes** — Bulk inserts all parsed `Attribute` entries into `attributes` table
7. **Assign root** — Updates the document's `root_node_id` to the first top-level node
8. **Commit** — Commits the transaction; on any failure, all inserts roll back

**Game modding workflow:**
```
User opens C:\DayZ\mpmissions\dayzOffline.chernarusplus\db\types.xml
  ↓
editor::open_document() runs in ~200ms
  ↓
Result: Document { id: 1, name: "types.xml", ... }
        nodes: [{ name: "types", ... }, { name: "type", ... }, ...]
        attributes: [{ name: "name", value: "AKM" }, ...]
  ↓
Frontend receives the flattened data → renders in TableView
```

**Error handling:** All errors are converted to `AppError` variants with appropriate severity and category. If XML parsing fails (malformed game config), the error propagates with parse-category severity so the Error Log Panel can display it.

---

### `search.rs` — Search Engine (131 lines)

Parameterized search across the XML document stored in SQLite.

#### `SearchResult`
```rust
pub struct SearchResult {
    pub node_id: i64,
    pub name: String,
    pub match_field: String,  // "name", "value", or "attribute"
    pub snippet: String,      // matched text for display
}
```

#### `search(query: &str, doc_id: i64, conn: &Connection, limit: Option<usize>) → Result<Vec<SearchResult>>`

Searches three dimensions simultaneously:

| Search Target | SQL Query | Example Match |
|---------------|-----------|---------------|
| **Node names** | `WHERE name LIKE '%query%'` | Searching "nominal" finds all `<nominal>` elements |
| **Node values** | `WHERE value LIKE '%query%'` | Searching "14400" finds lifetime values |
| **Attribute values** | `JOIN attributes WHERE value LIKE '%query%'` | Searching "M4A1" finds `name="M4A1"` attributes |

- Uses parameterized queries (`?1`) to prevent SQL injection
- Default limit: 500 results
- Results are sorted by match relevance (name matches first)

**Game modding usage:** A modder searches for "AKM" → the engine finds all nodes with `name="AKM"` attributes, any text values containing "AKM", and any element names containing "AKM". Results appear in the toolbar's search dropdown.

---

### `rules.rs` — Bulk Edit Rule Engine (181 lines)

The most powerful editing feature — apply complex filter+action rules to mass-edit game config values.

#### Data Structures

```rust
pub struct Rule {
    pub filters: Vec<RuleFilter>,   // conditions to match
    pub actions: Vec<RuleAction>,   // changes to apply
}

pub struct RuleFilter {
    pub field: String,     // "name", "value", or attribute name
    pub op: String,        // "equals", "not_equals", "contains", "greater_than", "less_than"
    pub value: String,     // comparison value
}

pub struct RuleAction {
    pub action_type: String,  // "SetAttribute", "AddTag", "RemoveTag", "SetValue", "DeleteNode"
    pub field: String,        // target field
    pub value: String,        // new value
}
```

#### `preview(rule: &Rule, doc_id: i64, conn: &Connection) → Result<usize>`

Dry-run — returns the count of nodes that would be affected without making changes. Essential for game modders to verify their rule before applying.

**Example:** "How many items have nominal > 20?" → preview returns 347

#### `apply(rule: &Rule, doc_id: i64, conn: &Connection) → Result<usize>`

Executes the rule in a SQLite transaction:

1. Loads all nodes + attributes for the document
2. Filters nodes through all `RuleFilter` conditions (AND logic)
3. For each matching node, applies all `RuleAction` changes
4. Returns the count of affected nodes
5. On any error, the entire transaction rolls back — no partial edits

**Filter operations:**
| Op | SQL Equivalent | Game Example |
|----|---------------|--------------|
| `equals` | `== value` | `name equals "AKM"` |
| `not_equals` | `!= value` | `category not_equals "weapons"` |
| `contains` | `LIKE %value%` | `name contains "AK"` |
| `greater_than` | `> value` (numeric) | `nominal greater_than 10` |
| `less_than` | `< value` (numeric) | `lifetime less_than 3600` |

**Action types:**
| Action | Effect | Game Example |
|--------|--------|--------------|
| `SetAttribute` | Sets/creates an attribute | Set `nominal` to `5` on all weapons |
| `SetValue` | Changes text value | Change all `<lifetime>` values to `7200` |
| `AddTag` | Adds a child `<tag>` | Add `<tag name="shelves"/>` to all items |
| `RemoveTag` | Removes a child `<tag>` | Remove `<usage name="Coast"/>` from items |
| `DeleteNode` | Removes the entire node | Delete all items with `category="food"` |

**Game modding usage:**
```
Rule: 
  Filters: [category contains "weapons", nominal greater_than 10]
  Actions: [SetValue "nominal" "5", SetValue "min" "3"]

Effect: All weapon items with nominal > 10 get their nominal set to 5 and min set to 3
```

> Note: Currently filters nodes in memory. SQL-level optimization is planned for Sprint 10.

---

### `macros.rs` — Macro Recorder (38 lines)

**Phase 5 stub.** Records named macros for repeatable editing sequences.

#### `record(name: &str, steps: &str, conn: &Connection) → Result<()>`

Saves a macro with a name and JSON-encoded step list to the `macros` table.

**Planned features (Phase 5+):**
- Record editing actions as macro steps
- Playback macros on different documents
- Share macros between modders
- Conditional macro logic (if element has attribute X, do Y)

---

## Layer Architecture

```
commands.rs ──→ app/editor.rs  ──→ core/xml/parser.rs
                                   core/db/setup.rs
            ──→ app/search.rs  ──→ core/db (SQL queries)
            ──→ app/rules.rs   ──→ core/db (transactions)
            ──→ app/macros.rs  ──→ core/db (insert)
```

The app layer never directly accesses the file system or XML parsing — it always delegates to core modules, keeping each layer focused on its responsibility.
