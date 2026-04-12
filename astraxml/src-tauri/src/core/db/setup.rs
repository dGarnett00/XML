/// SQLite database setup and migrations.
/// All data is stored locally — no network, no telemetry.
use rusqlite::{Connection, Result};

pub fn open(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    apply_migrations(&conn)?;
    Ok(conn)
}

pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    apply_migrations(&conn)?;
    Ok(conn)
}

fn apply_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS documents (
            id           TEXT PRIMARY KEY,
            path         TEXT NOT NULL,
            display_name TEXT NOT NULL,
            xml_version  TEXT NOT NULL DEFAULT '1.0',
            encoding     TEXT NOT NULL DEFAULT 'UTF-8',
            root_node_id TEXT,
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL,
            last_opened_at TEXT NOT NULL,
            schema_id    TEXT
        );

        CREATE TABLE IF NOT EXISTS xml_nodes (
            id           TEXT PRIMARY KEY,
            document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            parent_id    TEXT,
            node_type    TEXT NOT NULL,
            name         TEXT NOT NULL,
            value        TEXT,
            order_index  INTEGER NOT NULL DEFAULT 0,
            depth        INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_nodes_doc   ON xml_nodes(document_id);
        CREATE INDEX IF NOT EXISTS idx_nodes_parent ON xml_nodes(parent_id);
        CREATE INDEX IF NOT EXISTS idx_nodes_name   ON xml_nodes(name);

        CREATE TABLE IF NOT EXISTS attributes (
            id      TEXT PRIMARY KEY,
            node_id TEXT NOT NULL REFERENCES xml_nodes(id) ON DELETE CASCADE,
            name    TEXT NOT NULL,
            value   TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_attrs_node ON attributes(node_id);
        CREATE INDEX IF NOT EXISTS idx_attrs_name ON attributes(name);

        CREATE TABLE IF NOT EXISTS tags (
            id          TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            node_id     TEXT NOT NULL REFERENCES xml_nodes(id) ON DELETE CASCADE,
            name        TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tags_node ON tags(node_id);

        CREATE TABLE IF NOT EXISTS edit_snapshots (
            id          TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            created_at  TEXT NOT NULL,
            diff_blob   TEXT NOT NULL,
            summary     TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS error_log (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL,
            timestamp   TEXT NOT NULL,
            severity    TEXT NOT NULL CHECK(severity IN ('debug','info','warn','error','fatal')),
            category    TEXT NOT NULL,
            source      TEXT NOT NULL,
            message     TEXT NOT NULL,
            detail      TEXT,
            context     TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_errlog_session  ON error_log(session_id);
        CREATE INDEX IF NOT EXISTS idx_errlog_severity ON error_log(severity);
        CREATE INDEX IF NOT EXISTS idx_errlog_ts       ON error_log(timestamp);

        CREATE TABLE IF NOT EXISTS presets (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            preset_type TEXT NOT NULL,
            payload     TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS macros (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            steps      TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS schemas (
            id          TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            schema_type TEXT NOT NULL,
            raw_schema  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS index_entries (
            id          TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            node_id     TEXT NOT NULL REFERENCES xml_nodes(id) ON DELETE CASCADE,
            name_hash   TEXT NOT NULL,
            value_hash  TEXT NOT NULL,
            path_string TEXT NOT NULL,
            tags        TEXT NOT NULL DEFAULT '[]',
            numeric_cache REAL
        );

        CREATE INDEX IF NOT EXISTS idx_index_name  ON index_entries(name_hash);
        CREATE INDEX IF NOT EXISTS idx_index_value ON index_entries(value_hash);
        CREATE INDEX IF NOT EXISTS idx_index_path  ON index_entries(path_string);
        ",
    )?;

    Ok(())
}
