import { useState } from 'react';
import { useAppStore, XmlNode } from '../store/app';
import './TreeView.css';

function TreeNode({ node, allNodes }: { node: XmlNode; allNodes: XmlNode[] }) {
  const [expanded, setExpanded] = useState(true);
  const { selectedNodeId, selectNode } = useAppStore();

  const children = allNodes.filter(
    (n) => n.parentId === node.id && n.nodeType === 'element'
  );

  const hasChildren = children.length > 0;

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
          {hasChildren ? (expanded ? '▾' : '▸') : '·'}
        </span>
        <span className="tree-node__name">{node.name}</span>
      </div>
      {hasChildren && expanded && (
        <div className="tree-node__children">
          {children.map((child) => (
            <TreeNode key={child.id} node={child} allNodes={allNodes} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TreeView() {
  const { nodes, document } = useAppStore();
  const roots = nodes.filter((n) => n.parentId === null && n.nodeType === 'element');

  if (!document) {
    return <div className="tree-view tree-view--empty"><p>No document open</p></div>;
  }

  return (
    <div className="tree-view">
      {roots.map((root) => (
        <TreeNode key={root.id} node={root} allNodes={nodes} />
      ))}
    </div>
  );
}
