import { useMemo, useState } from 'react';
import { useAppStore, XmlNode } from '../store/app';
import { invoke } from '../lib/tauri';
import './DetailPanel.css';

export function DetailPanel() {
  const { nodes, attributes, selectedNodeId, document, addNodes, removeNodes, updateNodeLocal, selectNode } = useAppStore();
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

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editValue, setEditValue] = useState('');

  function startEdit() {
    if (!node) return;
    setEditName(node.name);
    setEditValue(node.value ?? '');
    setEditing(true);
  }

  async function saveEdit() {
    if (!node) return;
    try {
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
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
    setEditing(false);
  }

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
  }

  async function handleAddChild() {
    if (!node || !document) return;
    try {
      const newNode = await invoke<XmlNode>('add_node', {
        documentId: document.id,
        parentId: node.id,
        name: 'new_element',
        nodeType: 'element',
        value: null,
      });
      addNodes([newNode]);
      selectNode(newNode.id);
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }

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
          <label className="detail-panel__label">Name</label>
          <input
            className="detail-panel__input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            autoFocus
            title="Node name"
          />
          <label className="detail-panel__label">Value</label>
          <input
            className="detail-panel__input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            title="Node value"
          />
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

          {nodeAttrs.length > 0 && (
            <>
              <span className="detail-panel__label">Attributes</span>
              <div className="detail-panel__value">
                {nodeAttrs.map((a) => (
                  <div key={a.id} className="detail-panel__attr-row">
                    <span className="detail-panel__attr-name">{a.name}</span>
                    <span className="detail-panel__attr-eq">=</span>
                    <span className="detail-panel__attr-val">"{a.value}"</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="detail-panel__actions">
        {!editing && <button className="detail-panel__btn" onClick={startEdit}>Edit</button>}
        <button className="detail-panel__btn" onClick={handleAddChild}>+ Child</button>
        <button className="detail-panel__btn" onClick={handleClone}>Clone</button>
        <button className="detail-panel__btn detail-panel__btn--danger" onClick={handleDelete}>Delete</button>
      </div>
    </div>
  );
}
