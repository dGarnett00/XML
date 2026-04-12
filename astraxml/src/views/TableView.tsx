import { useAppStore } from '../store/app';
import './TableView.css';

export function TableView() {
  const { nodes, selectedNodeId, selectNode, document } = useAppStore();

  const elements = nodes.filter((n) => n.nodeType === 'element' && n.depth <= 2);

  if (!document) {
    return (
      <div className="table-view table-view--empty">
        <p>Open an XML file to begin editing</p>
        <p className="table-view__hint">File → Open  or drag & drop</p>
      </div>
    );
  }

  return (
    <div className="table-view">
      <table className="table-view__table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Value</th>
            <th>Depth</th>
          </tr>
        </thead>
        <tbody>
          {elements.map((node) => (
            <tr
              key={node.id}
              className={`table-view__row${node.id === selectedNodeId ? ' selected' : ''}`}
              onClick={() => selectNode(node.id)}
            >
              <td className="table-view__name" style={{ paddingLeft: `${node.depth * 16 + 8}px` }}>
                {node.name}
              </td>
              <td className="table-view__type">{node.nodeType}</td>
              <td className="table-view__value">{node.value ?? ''}</td>
              <td className="table-view__depth">{node.depth}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
