/// Document controller — open, save, close documents.
use chrono::Utc;
use rusqlite::{params, Connection};
use std::io::BufReader;
use uuid::Uuid;

use crate::core::xml::parser;
use crate::models::{Attribute, Document, XmlNode};

pub struct OpenResult {
    pub document: Document,
    pub nodes: Vec<XmlNode>,
    pub attributes: Vec<Attribute>,
}

/// Open an XML file, parse it, and persist everything to the DB.
pub fn open_document(conn: &Connection, path: &str) -> Result<OpenResult, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);

    let doc_id = Uuid::new_v4().to_string();
    let parse_result = parser::parse(&doc_id, reader)?;

    let display_name = std::path::Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "document.xml".to_string());

    let now = Utc::now().to_rfc3339();

    let doc = Document {
        id: doc_id.clone(),
        path: path.to_string(),
        display_name,
        xml_version: "1.0".to_string(),
        encoding: "UTF-8".to_string(),
        root_node_id: parse_result.root_node_id.clone(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        last_opened_at: Utc::now(),
        schema_id: None,
    };

    // Persist document
    conn.execute(
        "INSERT INTO documents
         (id, path, display_name, xml_version, encoding, root_node_id, created_at, updated_at, last_opened_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            doc.id, doc.path, doc.display_name, doc.xml_version, doc.encoding,
            doc.root_node_id, now, now, now
        ],
    )
    .map_err(|e| e.to_string())?;

    // Persist nodes
    for node in &parse_result.nodes {
        conn.execute(
            "INSERT INTO xml_nodes (id, document_id, parent_id, node_type, name, value, order_index, depth)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                node.id, node.document_id, node.parent_id,
                format!("{:?}", node.node_type).to_lowercase(),
                node.name, node.value, node.order_index, node.depth
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    // Persist attributes
    for attr in &parse_result.attributes {
        conn.execute(
            "INSERT INTO attributes (id, node_id, name, value) VALUES (?1,?2,?3,?4)",
            params![attr.id, attr.node_id, attr.name, attr.value],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(OpenResult {
        document: doc,
        nodes: parse_result.nodes,
        attributes: parse_result.attributes,
    })
}
