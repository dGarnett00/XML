import { memo, useMemo, useState } from 'react';
import { useAppStore, XmlNode, XmlAttribute } from '../store/app';
import { invoke } from '../lib/tauri';
import './TreeView.css';

type ChildrenByParent = Map<string | null, XmlNode[]>;
type AttrsByNode = Map<string, XmlAttribute[]>;

const EMPTY_CHILDREN: XmlNode[] = [];
const EMPTY_ATTRS: XmlAttribute[] = [];

const TreeNode = memo(function TreeNode({ node, childrenByParent, attrsByNode }: { node: XmlNode; childrenByParent: ChildrenByParent; attrsByNode: AttrsByNode }) {
  const [expanded, setExpanded] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [editValue, setEditValue] = useState('');
  const selectedNodeId = useAppStore((state) => state.selectedNodeId);
  const selectNode = useAppStore((state) => state.selectNode);
  const updateNodeLocal = useAppStore((state) => state.updateNodeLocal);

  const children = childrenByParent.get(node.id) ?? EMPTY_CHILDREN;
  const nodeAttrs = attrsByNode.get(node.id) ?? EMPTY_ATTRS;
  const hasChildren = children.length > 0;

  // Resolve inline text value: if this element has exactly one text child and no other element children
  const textChildren = children.filter((c) => c.nodeType === 'text');
  const elementChildren = children.filter((c) => c.nodeType === 'element');
  const inlineText = textChildren.length === 1 && elementChildren.length === 0 ? textChildren[0].value : null;

  function handleDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    setEditValue(node.name);
    setEditingName(true);
  }

  async function commitRename() {
    setEditingName(false);
    if (editValue && editValue !== node.name) {
      try {
        await invoke('update_node', { nodeId: node.id, name: editValue, value: null });
        updateNodeLocal(node.id, { name: editValue });
      } catch (e) {
        useAppStore.getState().setError(String(e));
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') setEditingName(false);
  }

  if (node.nodeType === 'text') {
    return (
      <div className="tree-node">
        <div
          className={`tree-node__row${node.id === selectedNodeId ? ' selected' : ''}`}
          onClick={() => selectNode(node.id)}
        >
          <span className="tree-node__toggle">·</span>
          <span className="tree-node__text-value">{node.value}</span>
        </div>
      </div>
    );
  }

  if (node.nodeType === 'comment') {
    return (
      <div className="tree-node">
        <div
          className={`tree-node__row${node.id === selectedNodeId ? ' selected' : ''}`}
          onClick={() => selectNode(node.id)}
        >
          <span className="tree-node__toggle">·</span>
          <span className="tree-node__comment">&lt;!--{node.value}--&gt;</span>
        </div>
      </div>
    );
  }

  // Element node
  // Show expandable children only for non-inline elements
  const showChildren = hasChildren && !inlineText;

  return (
    <div className="tree-node">
      <div
        className={`tree-node__row${node.id === selectedNodeId ? ' selected' : ''}`}
        onClick={() => selectNode(node.id)}
      >
        <span
          className="tree-node__toggle"
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        >
          {showChildren ? (expanded ? '▾' : '▸') : '·'}
        </span>
        {editingName ? (
          <input
            className="tree-node__edit"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            autoFocus
            title="Rename node"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <span className="tree-node__name" onDoubleClick={handleDoubleClick}>{node.name}</span>
            {nodeAttrs.map((attr) => (
              <span key={attr.id} className="tree-node__attr">
                {' '}<span className="tree-node__attr-name">{attr.name}</span>=<span className="tree-node__attr-value">"{attr.value}"</span>
              </span>
            ))}
            {inlineText !== null && (
              <span className="tree-node__inline-text"> {inlineText}</span>
            )}
          </>
        )}
      </div>
      {showChildren && expanded && (
        <div className="tree-node__children">
          {children.map((child) => (
            <TreeNode key={child.id} node={child} childrenByParent={childrenByParent} attrsByNode={attrsByNode} />
          ))}
        </div>
      )}
    </div>
  );
}
);

export function TreeView() {
  const nodes = useAppStore((s) => s.nodes);
  const attributes = useAppStore((s) => s.attributes);
  const document = useAppStore((s) => s.document);

  const childrenByParent: ChildrenByParent = useMemo(() => {
    const map: ChildrenByParent = new Map();
    for (const node of nodes) {
      const siblings = map.get(node.parentId);
      if (siblings) {
        siblings.push(node);
      } else {
        map.set(node.parentId, [node]);
      }
    }
    // Sort each group by orderIndex
    for (const list of map.values()) {
      list.sort((a, b) => a.orderIndex - b.orderIndex);
    }
    return map;
  }, [nodes]);

  const attrsByNode: AttrsByNode = useMemo(() => {
    const map: AttrsByNode = new Map();
    for (const attr of attributes) {
      const list = map.get(attr.nodeId);
      if (list) {
        list.push(attr);
      } else {
        map.set(attr.nodeId, [attr]);
      }
    }
    return map;
  }, [attributes]);

  const roots = childrenByParent.get(null) ?? EMPTY_CHILDREN;

  if (!document) {
    return <div className="tree-view tree-view--empty"><p>No document open</p></div>;
  }

  return (
    <div className="tree-view">
      {roots.map((root) => (
        <TreeNode key={root.id} node={root} childrenByParent={childrenByParent} attrsByNode={attrsByNode} />
      ))}
    </div>
  );
}
