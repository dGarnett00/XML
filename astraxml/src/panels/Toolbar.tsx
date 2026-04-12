import { useAppStore, ViewMode } from '../store/app';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import './Toolbar.css';

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'table', label: 'Table' },
  { id: 'tree',  label: 'Tree' },
  { id: 'raw',   label: 'Raw XML' },
];

export function Toolbar() {
  const { viewMode, setViewMode, document, searchQuery, setSearchQuery } = useAppStore();

  async function handleOpen() {
    const selected = await open({
      title: 'Open XML File',
      multiple: false,
      filters: [{ name: 'XML Files', extensions: ['xml'] }],
    });
    if (!selected) return;
    const path = typeof selected === 'string' ? selected : selected[0];
    try {
      const result = await invoke<{ document: any; nodeCount: number }>('open_document', { path });
      const store = useAppStore.getState();
      store.setDocument({
        id: result.document.id,
        path: result.document.path,
        displayName: result.document.display_name,
        rootNodeId: result.document.root_node_id,
        nodeCount: result.nodeCount,
      });
      // Load nodes into the store
      const nodes = await invoke<any[]>('get_nodes', { documentId: result.document.id });
      store.setNodes(nodes);
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }

  async function handleSave() {
    const doc = useAppStore.getState().document;
    if (!doc) return;
    try {
      // Save back to the original path
      await invoke('export_document', { documentId: doc.id, destPath: doc.path });
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }

  async function handleExport() {
    const doc = useAppStore.getState().document;
    if (!doc) return;
    const dest = await save({
      title: 'Export XML File',
      defaultPath: doc.displayName,
      filters: [{ name: 'XML Files', extensions: ['xml'] }],
    });
    if (!dest) return;
    try {
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
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
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
      </div>
    </header>
  );
}
