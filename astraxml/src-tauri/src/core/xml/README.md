# `xml/` — XML Processing Engine

> Streaming XML parser and serializer built on `quick-xml 0.36` for safe round-trip game config editing.

## Purpose

This module handles the two most critical operations in the editor: **parsing** game XML files into structured data and **serializing** edited data back into valid XML. The parser uses a streaming approach (SAX-style) that can handle massive game configs without loading the entire DOM into memory. The serializer ensures perfect round-trip fidelity with proper indentation and XML entity escaping.

---

## Files

### `mod.rs` (2 lines)

Module declarations:
```rust
pub mod parser;
pub mod serializer;
```

---

### `parser.rs` — Streaming XML Parser (205 lines)

#### `parse<R: BufRead>(reader: R) → Result<(Vec<XmlNode>, Vec<Attribute>)>`

Converts a raw XML byte stream into flat arrays of nodes and attributes using `quick-xml`'s pull parser.

#### How It Works

```
XML File (BufRead)
     │
     ▼
quick-xml::Reader::from_reader()
     │
     ▼
Event Loop:
  Start(<tag>) → push Element node, push to parent stack
  Empty(<tag/>) → push Element node (self-closing, no stack push)
  Text(content) → push Text node under current parent
  Comment(<!--..-->) → push Comment node under current parent
  End(</tag>) → pop parent stack
  Eof → break
     │
     ▼
Result: (Vec<XmlNode>, Vec<Attribute>)
```

#### Key Implementation Details

**Parent tracking:** A stack (`Vec<(i64, String)>`) tracks the current nesting depth. When a `Start` event fires, the new element is pushed onto the stack. When `End` fires, the stack pops. Text, Comment, and Empty elements use the top of the stack as their parent.

**Order indexing:** A `HashMap<Option<i64>, i32>` tracks per-parent insertion order. Each child element gets an `order_index` that preserves the original document ordering. This is critical for game configs where element order matters (e.g., `<nominal>` before `<min>`).

**Attribute extraction:** For `Start` and `Empty` events, all XML attributes are extracted and stored as separate `Attribute` entries linked to the node by ID.

**ID generation:** Nodes get sequential IDs starting from 1 (incremented per node). Attributes also get sequential IDs. These are temporary in-memory IDs — SQLite assigns permanent rowids on insertion.

#### Game Config Example

Given this DayZ `types.xml` fragment:
```xml
<types>
  <type name="AKM">
    <nominal>10</nominal>
    <min>5</min>
    <category name="weapons"/>
  </type>
</types>
```

The parser produces:

**Nodes:**
| id | parent_id | type | name | value | depth | order |
|----|-----------|------|------|-------|-------|-------|
| 1 | null | Element | types | null | 0 | 0 |
| 2 | 1 | Element | type | null | 1 | 0 |
| 3 | 2 | Element | nominal | null | 2 | 0 |
| 4 | 3 | Text | (text) | 10 | 3 | 0 |
| 5 | 2 | Element | min | null | 2 | 1 |
| 6 | 5 | Text | (text) | 5 | 3 | 0 |
| 7 | 2 | Element | category | null | 2 | 2 |

**Attributes:**
| id | node_id | name | value |
|----|---------|------|-------|
| 1 | 2 | name | AKM |
| 2 | 7 | name | weapons |

#### Tests

Two unit tests included:
1. **Sibling ordering** — Verifies that multiple children of the same parent get incrementing `order_index`
2. **Empty root elements** — Verifies self-closing root elements are handled correctly

---

### `serializer.rs` — XML Serializer (116 lines)

#### `serialize(nodes: &[XmlNode], attributes: &[Attribute]) → String`

Converts flat node/attribute arrays back into a formatted XML string with proper indentation and entity escaping.

#### How It Works

```
Vec<XmlNode> + Vec<Attribute>
     │
     ▼
Build lookup maps:
  children_map: HashMap<Option<i64>, Vec<&XmlNode>>  (sorted by order_index)
  attr_map:     HashMap<i64, Vec<&Attribute>>
     │
     ▼
Find root nodes (parent_id == None)
     │
     ▼
Recursive write_node():
  Element with children → <tag attrs>\n  {children}\n</tag>
  Element with single text child → <tag attrs>text</tag>  (inline)
  Element empty → <tag attrs/>
  Text → escaped text content
  Comment → <!-- content -->
     │
     ▼
Result: String (formatted XML)
```

#### Key Features

**Inline text optimization:** If an element has exactly one child and that child is a Text node, the text is rendered inline:
```xml
<nominal>10</nominal>
```
Instead of:
```xml
<nominal>
  10
</nominal>
```

This matches how game modders expect their configs to look.

**Entity escaping:** The `escape_xml()` function handles five XML entities:
| Character | Escaped |
|-----------|---------|
| `&` | `&amp;` |
| `<` | `&lt;` |
| `>` | `&gt;` |
| `"` | `&quot;` |
| `'` | `&apos;` |

This prevents data corruption when item names or values contain special characters.

**Indentation:** 2-space indentation at each depth level, matching standard XML formatting conventions.

**Attribute serialization:** Attributes are rendered in their stored order: `<type name="AKM" user="yes">`.

---

## Round-Trip Guarantee

The parser and serializer are designed as a matched pair:

```
Original XML → parse() → (nodes, attrs) → serialize() → Output XML
```

The output should be semantically identical to the input. Whitespace may be normalized (consistent 2-space indent), but the data, structure, and attribute values are preserved exactly. This is critical for game modding — saving a file should never corrupt the config.
