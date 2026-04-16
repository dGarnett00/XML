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
pub fn open_document(conn: &mut Connection, path: &str) -> Result<OpenResult, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::with_capacity(256 * 1024, file);

    let doc_id = Uuid::new_v4().to_string();
    let parse_result = parser::parse(&doc_id, reader)?;

    let display_name = std::path::Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "document.xml".to_string());

    let now = Utc::now();
    let now_rfc3339 = now.to_rfc3339();

    let doc = Document {
        id: doc_id.clone(),
        path: path.to_string(),
        display_name,
        xml_version: "1.0".to_string(),
        encoding: "UTF-8".to_string(),
        root_node_id: parse_result.root_node_id.clone(),
        created_at: now.clone(),
        updated_at: now.clone(),
        last_opened_at: now.clone(),
        schema_id: None,
    };

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO documents
         (id, path, display_name, xml_version, encoding, root_node_id, created_at, updated_at, last_opened_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            &doc.id,
            &doc.path,
            &doc.display_name,
            &doc.xml_version,
            &doc.encoding,
            &doc.root_node_id,
            &now_rfc3339,
            &now_rfc3339,
            &now_rfc3339
        ],
    )
    .map_err(|e| e.to_string())?;

    {
        let mut node_stmt = tx
            .prepare(
                "INSERT INTO xml_nodes (id, document_id, parent_id, node_type, name, value, order_index, depth)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            )
            .map_err(|e| e.to_string())?;

        for node in &parse_result.nodes {
            node_stmt
                .execute(params![
                    &node.id,
                    &node.document_id,
                    &node.parent_id,
                    &node.node_type,
                    &node.name,
                    &node.value,
                    node.order_index,
                    node.depth
                ])
                .map_err(|e| e.to_string())?;
        }
    }

    {
        let mut attr_stmt = tx
            .prepare("INSERT INTO attributes (id, node_id, name, value) VALUES (?1,?2,?3,?4)")
            .map_err(|e| e.to_string())?;

        for attr in &parse_result.attributes {
            attr_stmt
                .execute(params![&attr.id, &attr.node_id, &attr.name, &attr.value])
                .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(OpenResult {
        document: doc,
        nodes: parse_result.nodes,
        attributes: parse_result.attributes,
    })
}
