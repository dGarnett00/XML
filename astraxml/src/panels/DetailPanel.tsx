import { useMemo, useState, useCallback } from 'react';
import { useAppStore, XmlNode, XmlAttribute } from '../store/app';
import { invoke } from '../lib/tauri';
import './DetailPanel.css';

export function DetailPanel() {
  const nodes = useAppStore((s) => s.nodes);
  const attributes = useAppStore((s) => s.attributes);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const document = useAppStore((s) => s.document);
  const addNodes = useAppStore((s) => s.addNodes);
  const removeNodes = useAppStore((s) => s.removeNodes);
  const updateNodeLocal = useAppStore((s) => s.updateNodeLocal);
  const addAttributeLocal = useAppStore((s) => s.addAttributeLocal);
  const updateAttributeLocal = useAppStore((s) => s.updateAttributeLocal);
  const removeAttributeLocal = useAppStore((s) => s.removeAttributeLocal);
  const selectNode = useAppStore((s) => s.selectNode);
  const node = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;

  // Attributes for the selected node
  const nodeAttrs = useMemo(() => {
    if (!node) return [];
    return attributes.filter((a) => a.nodeId === node.id);
  }, [node, attributes]);

  // Resolve text value from child text node
  const textValue = useMemo(() => {
    if (!node) return null;
    const textChild = nodes.find((n) => n.parentId === node.id && n.nodeType === 'text');
    return textChild?.value ?? null;
  }, [node, nodes]);

  // ── Edit state ────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editValue, setEditValue] = useState('');

  // ── Attribute editing state ───────────────────────────────────────────
  const [editingAttrId, setEditingAttrId] = useState<string | null>(null);
  const [editAttrName, setEditAttrName] = useState('');
  const [editAttrValue, setEditAttrValue] = useState('');
  const [addingAttr, setAddingAttr] = useState(false);
  const [newAttrName, setNewAttrName] = useState('');
  const [newAttrValue, setNewAttrValue] = useState('');

  // ── Add Child state ───────────────────────────────────────────────────
  const [showAddChild, setShowAddChild] = useState(false);
  const [childName, setChildName] = useState('');
  const [childType, setChildType] = useState<'element' | 'text' | 'comment'>('element');

  // ── Delete confirmation state ─────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ── Node editing ──────────────────────────────────────────────────────

  function startEdit() {
    if (!node) return;
    if (node.nodeType === 'element') {
      setEditName(node.name);
      setEditValue(textValue ?? '');
    } else {
      setEditName(node.name);
      setEditValue(node.value ?? '');
    }
    setEditing(true);
  }

  async function saveEdit() {
    if (!node) return;
    try {
      if (node.nodeType === 'element') {
        const nameChanged = editName !== node.name ? editName : undefined;
        if (nameChanged !== undefined) {
          await invoke('update_node', { nodeId: node.id, name: nameChanged, value: null });
          updateNodeLocal(node.id, { name: nameChanged });
        }
        // Update text child value
        if (editValue !== (textValue ?? '')) {
          const textChild = nodes.find((n) => n.parentId === node.id && n.nodeType === 'text');
          if (textChild) {
            await invoke('update_node', { nodeId: textChild.id, name: null, value: editValue });
            updateNodeLocal(textChild.id, { value: editValue });
          } else if (editValue && document) {
            // Create a text child node
            const newNode = await invoke<XmlNode>('add_node', {
              documentId: document.id,
              parentId: node.id,
              name: '#text',
              nodeType: 'text',
              value: editValue,
            });
            addNodes([newNode]);
          }
        }
      } else {
        // text/comment nodes: update value directly
        const nameChanged = editName !== node.name ? editName : undefined;
        const valueChanged = editValue !== (node.value ?? '') ? editValue : undefined;
        if (nameChanged !== undefined || valueChanged !== undefined) {
          await invoke('update_node', {
            nodeId: node.id,
            name: nameChanged ?? null,
            value: valueChanged ?? null,
          });
          updateNodeLocal(node.id, {
            ...(nameChanged !== undefined ? { name: nameChanged } : {}),
            ...(valueChanged !== undefined ? { value: valueChanged } : {}),
          });
        }
      }
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
    setEditing(false);
  }

  // ── Attribute CRUD ────────────────────────────────────────────────────

  function startEditAttr(attr: XmlAttribute) {
    setEditingAttrId(attr.id);
    setEditAttrName(attr.name);
    setEditAttrValue(attr.value);
  }

  const saveAttrEdit = useCallback(async () => {
    if (!editingAttrId || !node) return;
    const attr = nodeAttrs.find((a) => a.id === editingAttrId);
    if (!attr) return;
    try {
      if (editAttrName !== attr.name) {
        // Name changed: delete old, create new
        await invoke('delete_attribute', { attrId: attr.id });
        const newAttr = await invoke<XmlAttribute>('add_attribute', {
          nodeId: node.id,
          attrName: editAttrName,
          attrValue: editAttrValue,
        });
        removeAttributeLocal(attr.id);
        addAttributeLocal(newAttr);
      } else if (editAttrValue !== attr.value) {
        await invoke('set_attribute', { nodeId: node.id, attrName: attr.name, attrValue: editAttrValue });
        updateAttributeLocal(attr.id, { value: editAttrValue });
      }
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
    setEditingAttrId(null);
  }, [editingAttrId, editAttrName, editAttrValue, node, nodeAttrs, removeAttributeLocal, addAttributeLocal, updateAttributeLocal]);

  async function handleAddAttr() {
    if (!node || !newAttrName.trim()) return;
    try {
      const attr = await invoke<XmlAttribute>('add_attribute', {
        nodeId: node.id,
        attrName: newAttrName.trim(),
        attrValue: newAttrValue,
      });
      addAttributeLocal(attr);
      setNewAttrName('');
      setNewAttrValue('');
      setAddingAttr(false);
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }

  async function handleDeleteAttr(attrId: string) {
    try {
      await invoke('delete_attribute', { attrId });
      removeAttributeLocal(attrId);
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }

  // ── Node actions ──────────────────────────────────────────────────────

  async function handleClone() {
    if (!node) return;
    try {
      const newNodes = await invoke<XmlNode[]>('clone_node', { nodeId: node.id });
      addNodes(newNodes);
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }

  async function handleDelete() {
    if (!node) return;
    try {
      const deletedIds = await invoke<string[]>('delete_node', { nodeId: node.id });
      removeNodes(deletedIds);
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
    setConfirmDelete(false);
  }

  async function handleAddChild() {
    if (!node || !document || !childName.trim()) return;
    try {
      const newNode = await invoke<XmlNode>('add_node', {
        documentId: document.id,
        parentId: node.id,
        name: childName.trim(),
        nodeType: childType,
        value: childType !== 'element' ? '' : null,
      });
      addNodes([newNode]);
      selectNode(newNode.id);
      setChildName('');
      setShowAddChild(false);
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (!node) {
    return (
      <div className="detail-panel detail-panel--empty">
        <p>Select a node to view details</p>
      </div>
    );
  }

  return (
    <div className="detail-panel">
      <div className="detail-panel__header">Selection Details</div>

      {editing ? (
        <div className="detail-panel__edit-form">
          {node.nodeType === 'element' ? (
            <>
              <label className="detail-panel__label">Tag Name</label>
              <input
                className="detail-panel__input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
                title="Element tag name"
              />
              <label className="detail-panel__label">Text Content</label>
              <textarea
                className="detail-panel__input detail-panel__textarea"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                title="Text content"
                rows={3}
              />
            </>
          ) : node.nodeType === 'comment' ? (
            <>
              <label className="detail-panel__label">Comment</label>
              <textarea
                className="detail-panel__input detail-panel__textarea"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                autoFocus
                title="Comment text"
                rows={4}
              />
            </>
          ) : (
            <>
              <label className="detail-panel__label">Value</label>
              <textarea
                className="detail-panel__input detail-panel__textarea"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                autoFocus
                title="Text value"
                rows={4}
              />
            </>
          )}
          <div className="detail-panel__edit-actions">
            <button className="detail-panel__btn detail-panel__btn--save" onClick={saveEdit}>Save</button>
            <button className="detail-panel__btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="detail-panel__grid">
          <span className="detail-panel__label">Name</span>
          <span className="detail-panel__value">{node.name}</span>

          <span className="detail-panel__label">Type</span>
          <span className="detail-panel__value">{node.nodeType}</span>

          <span className="detail-panel__label">Depth</span>
          <span className="detail-panel__value">{node.depth}</span>

          {textValue && (
            <>
              <span className="detail-panel__label">Value</span>
              <span className="detail-panel__value detail-panel__value--mono">{textValue}</span>
            </>
          )}

          {node.value && node.nodeType !== 'element' && (
            <>
              <span className="detail-panel__label">Value</span>
              <span className="detail-panel__value detail-panel__value--mono">{node.value}</span>
            </>
          )}
        </div>
      )}

      {/* ── Attributes Section ─────────────────────────────────────── */}
      {node.nodeType === 'element' && !editing && (
        <div className="detail-panel__attrs-section">
          <div className="detail-panel__attrs-header">
            <span className="detail-panel__label">Attributes</span>
            <button
              className="detail-panel__btn-icon"
              onClick={() => setAddingAttr(true)}
              title="Add attribute"
            >+</button>
          </div>

          {nodeAttrs.length === 0 && !addingAttr && (
            <span className="detail-panel__no-attrs">No attributes</span>
          )}

          {nodeAttrs.map((a) =>
            editingAttrId === a.id ? (
              <div key={a.id} className="detail-panel__attr-edit-row">
                <input
                  className="detail-panel__input detail-panel__input--sm"
                  value={editAttrName}
                  onChange={(e) => setEditAttrName(e.target.value)}
                  placeholder="name"
                  autoFocus
                  title="Attribute name"
                />
                <span className="detail-panel__attr-eq">=</span>
                <input
                  className="detail-panel__input detail-panel__input--sm"
                  value={editAttrValue}
                  onChange={(e) => setEditAttrValue(e.target.value)}
                  placeholder="value"
                  title="Attribute value"
                  onKeyDown={(e) => { if (e.key === 'Enter') saveAttrEdit(); if (e.key === 'Escape') setEditingAttrId(null); }}
                />
                <button className="detail-panel__btn-icon detail-panel__btn-icon--save" onClick={saveAttrEdit} title="Save">✓</button>
                <button className="detail-panel__btn-icon" onClick={() => setEditingAttrId(null)} title="Cancel">✕</button>
              </div>
            ) : (
              <div key={a.id} className="detail-panel__attr-row detail-panel__attr-row--interactive">
                <span className="detail-panel__attr-name" onDoubleClick={() => startEditAttr(a)}>{a.name}</span>
                <span className="detail-panel__attr-eq">=</span>
                <span className="detail-panel__attr-val" onDoubleClick={() => startEditAttr(a)}>"{a.value}"</span>
                <button
                  className="detail-panel__btn-icon detail-panel__btn-icon--delete"
                  onClick={() => handleDeleteAttr(a.id)}
                  title="Delete attribute"
                >×</button>
              </div>
            )
          )}

          {addingAttr && (
            <div className="detail-panel__attr-edit-row">
              <input
                className="detail-panel__input detail-panel__input--sm"
                value={newAttrName}
                onChange={(e) => setNewAttrName(e.target.value)}
                placeholder="name"
                autoFocus
                title="New attribute name"
              />
              <span className="detail-panel__attr-eq">=</span>
              <input
                className="detail-panel__input detail-panel__input--sm"
                value={newAttrValue}
                onChange={(e) => setNewAttrValue(e.target.value)}
                placeholder="value"
                title="New attribute value"
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddAttr(); if (e.key === 'Escape') setAddingAttr(false); }}
              />
              <button className="detail-panel__btn-icon detail-panel__btn-icon--save" onClick={handleAddAttr} title="Add">✓</button>
              <button className="detail-panel__btn-icon" onClick={() => setAddingAttr(false)} title="Cancel">✕</button>
            </div>
          )}
        </div>
      )}

      {/* ── Add Child Dialog ───────────────────────────────────────── */}
      {showAddChild && (
        <div className="detail-panel__add-child">
          <label className="detail-panel__label">Child Name</label>
          <input
            className="detail-panel__input"
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            placeholder="element_name"
            autoFocus
            title="New child node name"
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddChild(); if (e.key === 'Escape') setShowAddChild(false); }}
          />
          <div className="detail-panel__type-select">
            {(['element', 'text', 'comment'] as const).map((t) => (
              <button
                key={t}
                className={`detail-panel__type-btn${childType === t ? ' active' : ''}`}
                onClick={() => setChildType(t)}
              >{t}</button>
            ))}
          </div>
          <div className="detail-panel__edit-actions">
            <button className="detail-panel__btn detail-panel__btn--save" onClick={handleAddChild}>Add</button>
            <button className="detail-panel__btn" onClick={() => setShowAddChild(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation ────────────────────────────────────── */}
      {confirmDelete && (
        <div className="detail-panel__confirm">
          <p className="detail-panel__confirm-text">Delete "{node.name}" and all children?</p>
          <div className="detail-panel__edit-actions">
            <button className="detail-panel__btn detail-panel__btn--danger" onClick={handleDelete}>Confirm Delete</button>
            <button className="detail-panel__btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Actions ────────────────────────────────────────────────── */}
      <div className="detail-panel__actions">
        {!editing && <button className="detail-panel__btn" onClick={startEdit}>Edit</button>}
        {!showAddChild && node.nodeType === 'element' && (
          <button className="detail-panel__btn" onClick={() => { setChildName(''); setShowAddChild(true); }}>+ Child</button>
        )}
        <button className="detail-panel__btn" onClick={handleClone}>Clone</button>
        {!confirmDelete && (
          <button className="detail-panel__btn detail-panel__btn--danger" onClick={() => setConfirmDelete(true)}>Delete</button>
        )}
      </div>
    </div>
  );
}
