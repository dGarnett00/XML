import { useState, useEffect, useRef } from 'react';
import { useAppStore, ViewMode, OpenDocumentResult } from '../store/app';
import { useErrorLogStore } from '../store/errorLog';
import { invoke, openFileDialog, saveFileDialog } from '../lib/tauri';
import './Toolbar.css';

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'table', label: 'Table' },
  { id: 'tree',  label: 'Tree' },
  { id: 'raw',   label: 'Raw XML' },
];

export function Toolbar() {
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const document = useAppStore((s) => s.document);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    debounceRef.current = setTimeout(() => setSearchQuery(localSearch), 300);
    return () => clearTimeout(debounceRef.current);
  }, [localSearch, setSearchQuery]);
  const toggleLog  = useErrorLogStore((s) => s.toggleVisible);
  const errorCount = useErrorLogStore((s) => s.countAbove('error'));

  async function handleOpen() {
    const store = useAppStore.getState();
    try {
      const path = await openFileDialog();
      if (!path) return;
      store.setLoading(true);
      store.setError(null);
      const result = await invoke<OpenDocumentResult>('open_document', { path });
      store.loadDocument(
        {
          id: result.document.id,
          path: result.document.path,
          displayName: result.document.displayName,
          rootNodeId: result.document.rootNodeId,
          nodeCount: result.nodeCount,
        },
        result.nodes,
        result.attributes,
      );
    } catch (e) {
      store.setError(String(e));
    } finally {
      store.setLoading(false);
    }
  }

  async function handleSave() {
    const doc = useAppStore.getState().document;
    if (!doc) return;
    try {
      await invoke('export_document', { documentId: doc.id, destPath: doc.path });
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }

  async function handleExport() {
    const doc = useAppStore.getState().document;
    if (!doc) return;
    try {
      const dest = await saveFileDialog(doc.displayName);
      if (!dest) return;
      await invoke('export_document', { documentId: doc.id, destPath: dest });
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <span className="toolbar__logo">AstraXML</span>
        {document && (
          <span className="toolbar__file">{document.displayName}</span>
        )}
        <span className="toolbar__badge">Offline</span>
      </div>

      <div className="toolbar__search">
        <input
          className="toolbar__input"
          type="text"
          placeholder="Search nodes, attributes, values…"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
        />
      </div>

      <div className="toolbar__views">
        {VIEW_MODES.map((m) => (
          <button
            key={m.id}
            className={`toolbar__view-btn${viewMode === m.id ? ' active' : ''}`}
            onClick={() => setViewMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="toolbar__actions">
        <button className="toolbar__btn" onClick={handleOpen}>Open</button>
        <button className="toolbar__btn" onClick={handleSave} disabled={!document}>Save</button>
        <button className="toolbar__btn" onClick={handleExport} disabled={!document}>Export</button>
        <button className="toolbar__btn toolbar__btn--accent">Bulk Edit</button>
        <button
          className={`toolbar__btn toolbar__log-btn${errorCount > 0 ? ' toolbar__log-btn--alert' : ''}`}
          onClick={toggleLog}
          title="Toggle error log"
        >
          {errorCount > 0 ? `⚠ ${errorCount}` : 'Log'}
        </button>
      </div>
    </header>
  );
}
