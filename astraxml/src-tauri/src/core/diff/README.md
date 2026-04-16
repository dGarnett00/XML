# `diff/` — Diff & Snapshot Engine

> Line-based diff computation and edit snapshot storage for undo/redo history.

## Purpose

This module tracks every editing session by computing diffs between document states and storing them as snapshots in SQLite. This enables game modders to see what changed, compare versions, and eventually undo/redo edits. Each snapshot captures the delta between the previous and current XML serialization.

---

## Files

### `mod.rs` (1 line)

Module declaration:
```rust
pub mod snapshot;
```

---

### `snapshot.rs` — Snapshot Engine (93 lines)

#### `save_snapshot(doc_id: i64, label: &str, previous: &str, current: &str, conn: &Connection) → Result<()>`

Computes a line-based diff between two XML strings and stores the result in the `edit_snapshots` table.

**Process:**
1. Split `previous` and `current` into lines
2. Compare line-by-line to build a diff
3. Generate a patch string showing additions (`+`) and removals (`-`)
4. Insert into `edit_snapshots` with:
   - `doc_id` — which document this snapshot belongs to
   - `timestamp` — ISO 8601 timestamp
   - `label` — human-readable description (e.g., "Changed nominal for AKM")
   - `patch_data` — the computed diff string

**Diff algorithm:** Naive line-by-line comparison. Lines present in `current` but not in `previous` are marked as additions. Lines present in `previous` but not in `current` are marked as deletions. This approach is simple and fast, suitable for tracking incremental edits.

#### `list_snapshots(doc_id: i64, conn: &Connection) → Result<Vec<EditSnapshot>>`

Retrieves all snapshots for a document, ordered oldest-first.

**Returns:**
```rust
pub struct EditSnapshot {
    pub id: i64,
    pub doc_id: i64,
    pub timestamp: String,
    pub label: String,
    pub patch_data: String,
}
```

---

## Snapshot Lifecycle

```
1. User opens types.xml → initial state stored
2. User changes AKM nominal from 10 to 5
   → save_snapshot("Changed nominal", old_xml, new_xml)
   → diff: "- <nominal>10</nominal>"
           "+ <nominal>5</nominal>"
3. User changes all weapon lifetimes via bulk edit
   → save_snapshot("Bulk edit: weapon lifetimes", ...)
   → diff: multiple changed lines
4. User can list_snapshots() to see history
```

---

## Game Modding Context

Game modders often make experimental changes to test server behavior:
- "What happens if I set all weapon nominals to 0?"
- "Let me add coast spawns to all medical items"

The snapshot system lets them:
1. **Track changes** — See exactly what was modified in each editing session
2. **Compare versions** — View the diff between original and modified configs
3. **Roll back** — Eventually restore previous states (undo — planned feature)

This is especially valuable because game config edits can break server startup if values are invalid, so having a history of changes provides a safety net.

---

## Future Enhancements

- **Undo/redo** — Apply patches in reverse to restore previous states
- **Cherry-pick** — Select individual changes to undo while keeping others
- **Export diff** — Share changes with other modders as patch files
- **Visual diff viewer** — Side-by-side comparison in the UI
