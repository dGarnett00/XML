import { useAppStore } from '../store/app';
import { useErrorLogStore } from '../store/errorLog';
import './StatusBar.css';

export function StatusBar() {
  const { document, nodes, selectedNodeId, isLoading, error } = useAppStore();
  const errorCount  = useErrorLogStore((s) => s.countAbove('error'));
  const toggleLog   = useErrorLogStore((s) => s.toggleVisible);

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
      {errorCount > 0 && (
        <button
          className="statusbar__item statusbar__errcount"
          onClick={toggleLog}
          title="Open error log"
        >
          ⚠ {errorCount} error{errorCount !== 1 ? 's' : ''}
        </button>
      )}
      <span className="statusbar__item statusbar__version">AstraXML v0.1</span>
    </footer>
  );
}
