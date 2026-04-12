import { useAppStore } from '../store/app';
import './DetailPanel.css';

export function DetailPanel() {
  const { nodes, selectedNodeId } = useAppStore();
  const node = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;

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
      <div className="detail-panel__grid">
        <span className="detail-panel__label">Name</span>
        <span className="detail-panel__value">{node.name}</span>

        <span className="detail-panel__label">Type</span>
        <span className="detail-panel__value">{node.nodeType}</span>

        <span className="detail-panel__label">Depth</span>
        <span className="detail-panel__value">{node.depth}</span>

        {node.value && (
          <>
            <span className="detail-panel__label">Value</span>
            <span className="detail-panel__value detail-panel__value--mono">{node.value}</span>
          </>
        )}
      </div>

      <div className="detail-panel__actions">
        <button className="detail-panel__btn">Edit</button>
        <button className="detail-panel__btn">Clone</button>
        <button className="detail-panel__btn detail-panel__btn--danger">Delete</button>
        <button className="detail-panel__btn">History</button>
      </div>
    </div>
  );
}
