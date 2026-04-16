/// Streaming XML parser that builds a flat list of XmlNodes and Attributes.
/// Uses quick-xml in read-event mode to avoid loading the entire file into memory.
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use std::collections::HashMap;
use std::io::BufRead;
use uuid::Uuid;

use crate::models::{Attribute, NodeType, XmlNode};

#[derive(Debug)]
pub struct ParseResult {
    pub nodes: Vec<XmlNode>,
    pub attributes: Vec<Attribute>,
    pub root_node_id: Option<String>,
}

fn next_order_index(
    parent_id: &Option<String>,
    sibling_counts: &mut HashMap<Option<String>, i32>,
) -> i32 {
    let next = sibling_counts.entry(parent_id.clone()).or_insert(0);
    let order_index = *next;
    *next += 1;
    order_index
}

pub fn parse<R: BufRead>(document_id: &str, reader: R) -> Result<ParseResult, String> {
    let mut xml_reader = Reader::from_reader(reader);
    xml_reader.config_mut().trim_text(true);

    let mut nodes: Vec<XmlNode> = Vec::new();
    let mut attributes: Vec<Attribute> = Vec::new();
    let mut stack: Vec<String> = Vec::new();
    let mut sibling_counts: HashMap<Option<String>, i32> = HashMap::new();
    let mut buf = Vec::with_capacity(64 * 1024);
    let mut root_node_id: Option<String> = None;

    loop {
        match xml_reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let node_id = Uuid::new_v4().to_string();
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let parent_id = stack.last().cloned();
                let depth = stack.len() as i32;
                let order_index = next_order_index(&parent_id, &mut sibling_counts);

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
                let order_index = next_order_index(&parent_id, &mut sibling_counts);

                if root_node_id.is_none() {
                    root_node_id = Some(node_id.clone());
                }

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
                        let parent_id = Some(parent_id);
                        let depth = stack.len() as i32;
                        let order_index = next_order_index(&parent_id, &mut sibling_counts);
                        nodes.push(XmlNode {
                            id: Uuid::new_v4().to_string(),
                            document_id: document_id.to_string(),
                            parent_id,
                            node_type: NodeType::Text,
                            name: "#text".to_string(),
                            value: Some(text),
                            order_index,
                            depth,
                        });
                    }
                }
            }
            Ok(Event::Comment(e)) => {
                let text = e.unescape().map(|s| s.to_string()).unwrap_or_default();
                let parent_id = stack.last().cloned();
                let depth = stack.len() as i32;
                let order_index = next_order_index(&parent_id, &mut sibling_counts);
                nodes.push(XmlNode {
                    id: Uuid::new_v4().to_string(),
                    document_id: document_id.to_string(),
                    parent_id,
                    node_type: NodeType::Comment,
                    name: "#comment".to_string(),
                    value: Some(text),
                    order_index,
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

#[cfg(test)]
mod tests {
    use super::parse;
    use crate::models::NodeType;
    use std::io::Cursor;

    #[test]
    fn assigns_order_indexes_per_parent_in_one_pass() {
        let xml = r#"<root><first/><second>value</second><!--note--></root>"#;
        let result = parse("doc-1", Cursor::new(xml)).expect("parser should succeed");
        let root_id = result.root_node_id.expect("root node id should be set");

        let mut root_children = result
            .nodes
            .iter()
            .filter(|node| node.parent_id.as_deref() == Some(root_id.as_str()))
            .collect::<Vec<_>>();
        root_children.sort_by_key(|node| node.order_index);

        assert_eq!(root_children.len(), 3);
        assert_eq!(root_children[0].name, "first");
        assert_eq!(root_children[0].order_index, 0);
        assert_eq!(root_children[1].name, "second");
        assert_eq!(root_children[1].order_index, 1);
        assert_eq!(root_children[2].node_type, NodeType::Comment);
        assert_eq!(root_children[2].order_index, 2);

        let second_id = root_children[1].id.as_str();
        let text_node = result
            .nodes
            .iter()
            .find(|node| {
                node.parent_id.as_deref() == Some(second_id) && node.node_type == NodeType::Text
            })
            .expect("text child should exist");
        assert_eq!(text_node.order_index, 0);
    }

    #[test]
    fn sets_root_node_id_for_empty_root_elements() {
        let result = parse("doc-2", Cursor::new("<root/>"))
            .expect("parser should succeed for empty root nodes");

        assert_eq!(result.nodes.len(), 1);
        assert_eq!(result.root_node_id.as_deref(), Some(result.nodes[0].id.as_str()));
    }
}
