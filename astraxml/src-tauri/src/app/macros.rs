/// Macro recorder — Phase 5.
/// Records user actions as a replayable step list.
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::Macro;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroStep {
    pub step_type: String,
    pub payload: serde_json::Value,
}

pub fn record(
    conn: &Connection,
    name: &str,
    steps: &[MacroStep],
) -> Result<Macro, String> {
    let m = Macro {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        steps: serde_json::to_value(steps).map_err(|e| e.to_string())?,
        created_at: Utc::now(),
    };

    conn.execute(
        "INSERT INTO macros (id, name, steps, created_at) VALUES (?1,?2,?3,?4)",
        params![
            m.id,
            m.name,
            m.steps.to_string(),
            m.created_at.to_rfc3339()
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(m)
}
