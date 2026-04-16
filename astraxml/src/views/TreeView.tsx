import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, XmlNode, XmlAttribute } from '../store/app';
import { invoke } from '../lib/tauri';
import { ContextMenu, ContextMenuItem } from '../panels/ContextMenu';
import './TreeView.css';

type ChildrenByParent = Map<string | null, XmlNode[]>;
type AttrsByNode = Map<string, XmlAttribute[]>;

const EMPTY_CHILDREN: XmlNode[] = [];
const EMPTY_ATTRS: XmlAttribute[] = [];

interface TreeContextMenu {
  x: number;
  y: number;
  nodeId: string;
}

const TreeNode = memo(function TreeNode({ node, childrenByParent, attrsByNode, expandedIds, onToggleExpand, contextMenu, onContextMenu }: {
  node: XmlNode;
  childrenByParent: ChildrenByParent;
  attrsByNode: AttrsByNode;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  contextMenu: TreeContextMenu | null;
  onContextMenu: (e: React.MouseEvent, nodeId: string) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [editValue, setEditValue] = useState('');
  const selectedNodeId = useAppStore((state) => state.selectedNodeId);
  const selectNode = useAppStore((state) => state.selectNode);
  const updateNodeLocal = useAppStore((state) => state.updateNodeLocal);

  const children = childrenByParent.get(node.id) ?? EMPTY_CHILDREN;
  const nodeAttrs = attrsByNode.get(node.id) ?? EMPTY_ATTRS;
  const hasChildren = children.length > 0;
  const expanded = expandedIds.has(node.id);

  // Resolve inline text value
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

  function handleRightClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    selectNode(node.id);
    onContextMenu(e, node.id);
  }

  if (node.nodeType === 'text') {
    return (
      <div className="tree-node">
        <div
          className={`tree-node__row${node.id === selectedNodeId ? ' selected' : ''}`}
          onClick={() => selectNode(node.id)}
          onContextMenu={handleRightClick}
          data-node-id={node.id}
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
          onContextMenu={handleRightClick}
          data-node-id={node.id}
        >
          <span className="tree-node__toggle">·</span>
          <span className="tree-node__comment">&lt;!--{node.value}--&gt;</span>
        </div>
      </div>
    );
  }

  const showChildren = hasChildren && !inlineText;

  return (
    <div className="tree-node">
      <div
        className={`tree-node__row${node.id === selectedNodeId ? ' selected' : ''}`}
        onClick={() => selectNode(node.id)}
        onContextMenu={handleRightClick}
        data-node-id={node.id}
      >
        <span
          className="tree-node__toggle"
          onClick={(e) => { e.stopPropagation(); onToggleExpand(node.id); }}
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
            <TreeNode
              key={child.id}
              node={child}
              childrenByParent={childrenByParent}
              attrsByNode={attrsByNode}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              contextMenu={contextMenu}
              onContextMenu={onContextMenu}
            />
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
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const selectNode = useAppStore((s) => s.selectNode);
  const addNodes = useAppStore((s) => s.addNodes);
  const removeNodes = useAppStore((s) => s.removeNodes);
  const treeRef = useRef<HTMLDivElement>(null);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<TreeContextMenu | null>(null);
  const [initialized, setInitialized] = useState(false);

  const childrenByParent: ChildrenByParent = useMemo(() => {
    const map: ChildrenByParent = new Map();
    for (const node of nodes) {
      const siblings = map.get(node.parentId);
      if (siblings) siblings.push(node);
      else map.set(node.parentId, [node]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.orderIndex - b.orderIndex);
    }
    return map;
  }, [nodes]);

  const attrsByNode: AttrsByNode = useMemo(() => {
    const map: AttrsByNode = new Map();
    for (const attr of attributes) {
      const list = map.get(attr.nodeId);
      if (list) list.push(attr);
      else map.set(attr.nodeId, [attr]);
    }
    return map;
  }, [attributes]);

  // Build a flat ordered list of visible node IDs for keyboard navigation
  const flatNodeIds = useMemo(() => {
    const ids: string[] = [];
    function walk(parentId: string | null) {
      const children = childrenByParent.get(parentId) ?? [];
      for (const child of children) {
        ids.push(child.id);
        const textChildren = (childrenByParent.get(child.id) ?? []).filter((c) => c.nodeType === 'text');
        const elementChildren = (childrenByParent.get(child.id) ?? []).filter((c) => c.nodeType === 'element');
        const inlineText = textChildren.length === 1 && elementChildren.length === 0;
        const hasExpandableChildren = (childrenByParent.get(child.id) ?? []).length > 0 && !inlineText;
        if (hasExpandableChildren && expandedIds.has(child.id)) {
          walk(child.id);
        }
      }
    }
    walk(null);
    return ids;
  }, [childrenByParent, expandedIds]);

  // Initialize expand state: expand first two levels
  useEffect(() => {
    if (initialized || nodes.length === 0) return;
    const toExpand = new Set<string>();
    for (const n of nodes) {
      if (n.depth < 2 && n.nodeType === 'element') toExpand.add(n.id);
    }
    setExpandedIds(toExpand);
    setInitialized(true);
  }, [nodes, initialized]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const all = new Set<string>();
    for (const n of nodes) {
      if (n.nodeType === 'element') all.add(n.id);
    }
    setExpandedIds(all);
  }, [nodes]);

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  // ── Context menu actions ────────────────────────────────────────────────

  const handleContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId });
  }, []);

  async function handleClone(nodeId: string) {
    try {
      const newNodes = await invoke<XmlNode[]>('clone_node', { nodeId });
      addNodes(newNodes);
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }

  async function handleDelete(nodeId: string) {
    try {
      const deletedIds = await invoke<string[]>('delete_node', { nodeId });
      removeNodes(deletedIds);
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }

  async function handleAddChild(nodeId: string) {
    if (!document) return;
    try {
      const newNode = await invoke<XmlNode>('add_node', {
        documentId: document.id,
        parentId: nodeId,
        name: 'new_element',
        nodeType: 'element',
        value: null,
      });
      addNodes([newNode]);
      selectNode(newNode.id);
      setExpandedIds((prev) => new Set(prev).add(nodeId));
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!contextMenu) return [];
    const nodeId = contextMenu.nodeId;
    const node = nodes.find((n) => n.id === nodeId);
    return [
      { label: 'Add Child', icon: '➕', onClick: () => handleAddChild(nodeId), disabled: node?.nodeType !== 'element' },
      { label: 'Clone', icon: '📋', shortcut: 'Ctrl+D', onClick: () => handleClone(nodeId) },
      { label: 'separator', separator: true, onClick: () => {} },
      { label: 'Expand All', icon: '⊞', onClick: expandAll },
      { label: 'Collapse All', icon: '⊟', onClick: collapseAll },
      { label: 'separator', separator: true, onClick: () => {} },
      { label: 'Delete', icon: '🗑', shortcut: 'Del', danger: true, onClick: () => handleDelete(nodeId) },
    ];
  }, [contextMenu, nodes, expandAll, collapseAll]);

  // ── Keyboard navigation ─────────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!flatNodeIds.length) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      const currentIndex = selectedNodeId ? flatNodeIds.indexOf(selectedNodeId) : -1;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = Math.min(currentIndex + 1, flatNodeIds.length - 1);
          selectNode(flatNodeIds[next]);
          scrollToNode(flatNodeIds[next]);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = Math.max(currentIndex - 1, 0);
          selectNode(flatNodeIds[prev]);
          scrollToNode(flatNodeIds[prev]);
          break;
        }
        case 'ArrowRight': {
          if (selectedNodeId && !expandedIds.has(selectedNodeId)) {
            e.preventDefault();
            toggleExpand(selectedNodeId);
          }
          break;
        }
        case 'ArrowLeft': {
          if (selectedNodeId && expandedIds.has(selectedNodeId)) {
            e.preventDefault();
            toggleExpand(selectedNodeId);
          } else if (selectedNodeId) {
            // Navigate to parent
            const node = nodes.find((n) => n.id === selectedNodeId);
            if (node?.parentId) {
              e.preventDefault();
              selectNode(node.parentId);
              scrollToNode(node.parentId);
            }
          }
          break;
        }
        case 'Delete': {
          if (selectedNodeId) {
            e.preventDefault();
            handleDelete(selectedNodeId);
          }
          break;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flatNodeIds, selectedNodeId, expandedIds, nodes, selectNode, toggleExpand]);

  function scrollToNode(nodeId: string) {
    const el = treeRef.current?.querySelector(`[data-node-id="${nodeId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  const roots = childrenByParent.get(null) ?? EMPTY_CHILDREN;

  if (!document) {
    return <div className="tree-view tree-view--empty"><p>No document open</p></div>;
  }

  return (
    <div className="tree-view" ref={treeRef} tabIndex={0}>
      <div className="tree-view__toolbar">
        <button className="tree-view__toolbar-btn" onClick={expandAll} title="Expand all">⊞ Expand All</button>
        <button className="tree-view__toolbar-btn" onClick={collapseAll} title="Collapse all">⊟ Collapse All</button>
      </div>
      {roots.map((root) => (
        <TreeNode
          key={root.id}
          node={root}
          childrenByParent={childrenByParent}
          attrsByNode={attrsByNode}
          expandedIds={expandedIds}
          onToggleExpand={toggleExpand}
          contextMenu={contextMenu}
          onContextMenu={handleContextMenu}
        />
      ))}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
