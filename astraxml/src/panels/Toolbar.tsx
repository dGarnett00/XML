import { useAppStore, ViewMode } from '../store/app';
import { invoke } from '@tauri-apps/api/core';
import './Toolbar.css';

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'table', label: 'Table' },
  { id: 'tree',  label: 'Tree' },
  { id: 'raw',   label: 'Raw XML' },
];

export function Toolbar() {
  const { viewMode, setViewMode, document, searchQuery, setSearchQuery } = useAppStore();

  async function handleOpen() {
    // File dialog via Tauri — full implementation in Sprint 2
    const path = prompt('Enter XML file path:');
    if (!path) return;
    try {
      const result = await invoke<{ document: any; nodeCount: number }>('open_document', { path });
      useAppStore.getState().setDocument({
        id: result.document.id,
        path: result.document.path,
        displayName: result.document.display_name,
        rootNodeId: result.document.root_node_id,
        nodeCount: result.nodeCount,
      });
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
        <button className="toolbar__btn">Save</button>
        <button className="toolbar__btn toolbar__btn--accent">Bulk Edit</button>
      </div>
    </header>
  );
}
