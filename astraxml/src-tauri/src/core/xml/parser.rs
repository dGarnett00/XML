/// Streaming XML parser that builds a flat list of XmlNodes and Attributes.
/// Uses quick-xml in read-event mode to avoid loading the entire file into memory.
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use std::io::BufRead;
use uuid::Uuid;

use crate::models::{Attribute, NodeType, XmlNode};

#[derive(Debug)]
pub struct ParseResult {
    pub nodes: Vec<XmlNode>,
    pub attributes: Vec<Attribute>,
    pub root_node_id: Option<String>,
}

pub fn parse<R: BufRead>(document_id: &str, reader: R) -> Result<ParseResult, String> {
    let mut xml_reader = Reader::from_reader(reader);
    xml_reader.config_mut().trim_text(true);

    let mut nodes: Vec<XmlNode> = Vec::new();
    let mut attributes: Vec<Attribute> = Vec::new();
    let mut stack: Vec<String> = Vec::new();
    let mut buf = Vec::new();
    let mut root_node_id: Option<String> = None;

    loop {
        match xml_reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let node_id = Uuid::new_v4().to_string();
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let parent_id = stack.last().cloned();
                let depth = stack.len() as i32;
                let order_index = nodes
                    .iter()
                    .filter(|n| n.parent_id == parent_id)
                    .count() as i32;

                if root_node_id.is_none() {
                    root_node_id = Some(node_id.clone());
                }

                // collect attributes
                for attr in e.attributes().flatten() {
                    let attr_name =
                        String::from_utf8_lossy(attr.key.as_ref()).to_string();
                    let attr_value = attr
                        .unescape_value()
                        .map(|v| v.to_string())
                        .unwrap_or_default();
                    attributes.push(Attribute {
                        id: Uuid::new_v4().to_string(),
                        node_id: node_id.clone(),
                        name: attr_name,
                        value: attr_value,
                    });
                }

                nodes.push(XmlNode {
                    id: node_id.clone(),
                    document_id: document_id.to_string(),
                    parent_id,
                    node_type: NodeType::Element,
                    name,
                    value: None,
                    order_index,
                    depth,
                });

                stack.push(node_id);
            }
            Ok(Event::Empty(e)) => {
                let node_id = Uuid::new_v4().to_string();
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let parent_id = stack.last().cloned();
                let depth = stack.len() as i32;
                let order_index = nodes
                    .iter()
                    .filter(|n| n.parent_id == parent_id)
                    .count() as i32;

                for attr in e.attributes().flatten() {
                    let attr_name =
                        String::from_utf8_lossy(attr.key.as_ref()).to_string();
                    let attr_value = attr
                        .unescape_value()
                        .map(|v| v.to_string())
                        .unwrap_or_default();
                    attributes.push(Attribute {
                        id: Uuid::new_v4().to_string(),
                        node_id: node_id.clone(),
                        name: attr_name,
                        value: attr_value,
                    });
                }

                nodes.push(XmlNode {
                    id: node_id,
                    document_id: document_id.to_string(),
                    parent_id,
                    node_type: NodeType::Element,
                    name,
                    value: None,
                    order_index,
                    depth,
                });
                // empty element — no push to stack
            }
            Ok(Event::Text(e)) => {
                if let Some(parent_id) = stack.last().cloned() {
                    let text = e.unescape().map(|s| s.to_string()).unwrap_or_default();
                    if !text.trim().is_empty() {
                        let depth = stack.len() as i32;
                        nodes.push(XmlNode {
                            id: Uuid::new_v4().to_string(),
                            document_id: document_id.to_string(),
                            parent_id: Some(parent_id),
                            node_type: NodeType::Text,
                            name: "#text".to_string(),
                            value: Some(text),
                            order_index: 0,
                            depth,
                        });
                    }
                }
            }
            Ok(Event::Comment(e)) => {
                let text = e.unescape().map(|s| s.to_string()).unwrap_or_default();
                let parent_id = stack.last().cloned();
                let depth = stack.len() as i32;
                nodes.push(XmlNode {
                    id: Uuid::new_v4().to_string(),
                    document_id: document_id.to_string(),
                    parent_id,
                    node_type: NodeType::Comment,
                    name: "#comment".to_string(),
                    value: Some(text),
                    order_index: 0,
                    depth,
                });
            }
            Ok(Event::End(_)) => {
                stack.pop();
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {e}")),
            _ => {}
        }
        buf.clear();
    }

    Ok(ParseResult {
        nodes,
        attributes,
        root_node_id,
    })
}
