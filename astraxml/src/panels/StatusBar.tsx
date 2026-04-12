import { useAppStore } from '../store/app';
import './StatusBar.css';

export function StatusBar() {
  const { document, nodes, selectedNodeId, isLoading, error } = useAppStore();

  const selected = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId)
    : null;

  return (
    <footer className="statusbar">
      <span className="statusbar__item statusbar__offline">⬤ Offline</span>
      {document && (
        <span className="statusbar__item">
          {document.nodeCount.toLocaleString()} nodes
        </span>
      )}
      {selected && (
        <span className="statusbar__item statusbar__selected">
          {selected.name} ({selected.nodeType})
        </span>
      )}
      {isLoading && <span className="statusbar__item statusbar__loading">Loading…</span>}
      {error && <span className="statusbar__item statusbar__error">{error}</span>}
      <span className="statusbar__spacer" />
      <span className="statusbar__item statusbar__version">AstraXML v0.1</span>
    </footer>
  );
}
