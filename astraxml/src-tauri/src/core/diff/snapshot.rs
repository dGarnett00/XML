/// Diff and snapshot engine.
/// Each save creates a diff blob that can be replayed forward/backward.
use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::models::EditSnapshot;

/// Save a snapshot of the current XML state.
pub fn save_snapshot(
    conn: &Connection,
    document_id: &str,
    previous_xml: &str,
    current_xml: &str,
    summary: &str,
) -> Result<EditSnapshot, String> {
    let diff = compute_diff(previous_xml, current_xml);
    let snapshot = EditSnapshot {
        id: Uuid::new_v4().to_string(),
        document_id: document_id.to_string(),
        created_at: Utc::now(),
        diff_blob: diff,
        summary: summary.to_string(),
    };

    conn.execute(
        "INSERT INTO edit_snapshots (id, document_id, created_at, diff_blob, summary)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            snapshot.id,
            snapshot.document_id,
            snapshot.created_at.to_rfc3339(),
            snapshot.diff_blob,
            snapshot.summary,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(snapshot)
}

/// Retrieve all snapshots for a document, ordered oldest → newest.
pub fn list_snapshots(
    conn: &Connection,
    document_id: &str,
) -> Result<Vec<EditSnapshot>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, created_at, diff_blob, summary
             FROM edit_snapshots WHERE document_id = ?1
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![document_id], |row| {
            let created_at_str: String = row.get(2)?;
            Ok(EditSnapshot {
                id: row.get(0)?,
                document_id: row.get(1)?,
                created_at: chrono::DateTime::parse_from_rfc3339(&created_at_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                diff_blob: row.get(3)?,
                summary: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Simple line-based diff (unified format). Replace with a proper diff crate in Phase 5.
fn compute_diff(old: &str, new: &str) -> String {
    let old_lines: Vec<&str> = old.lines().collect();
    let new_lines: Vec<&str> = new.lines().collect();
    let mut diff = String::new();

    // Naive line diff — adequate for MVP
    let max = old_lines.len().max(new_lines.len());
    for i in 0..max {
        match (old_lines.get(i), new_lines.get(i)) {
            (Some(o), Some(n)) if o == n => diff.push_str(&format!("  {}\n", o)),
            (Some(o), Some(n)) => {
                diff.push_str(&format!("- {}\n", o));
                diff.push_str(&format!("+ {}\n", n));
            }
            (Some(o), None) => diff.push_str(&format!("- {}\n", o)),
            (None, Some(n)) => diff.push_str(&format!("+ {}\n", n)),
            (None, None) => {}
        }
    }
    diff
}
