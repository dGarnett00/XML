import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore, ViewMode, OpenDocumentResult } from '../store/app';
import { useErrorLogStore } from '../store/errorLog';
import { invoke, openFileDialog, saveFileDialog } from '../lib/tauri';
import './Toolbar.css';

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'table', label: 'Table' },
  { id: 'tree',  label: 'Tree' },
  { id: 'raw',   label: 'Raw XML' },
];

interface RuleFilter {
  field: string;
  op: 'equals' | 'notEquals' | 'contains' | 'greaterThan' | 'lessThan';
  value: string;
}

interface RuleAction {
  action: 'setAttribute' | 'addTag' | 'removeTag' | 'setValue' | 'deleteNode';
  field: string;
  value: string;
}

export function Toolbar() {
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const document = useAppStore((s) => s.document);
  const isDirty = useAppStore((s) => s.isDirty);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [showBulkEdit, setShowBulkEdit] = useState(false);

  // Bulk edit state
  const [bulkFilters, setBulkFilters] = useState<RuleFilter[]>([{ field: '', op: 'contains', value: '' }]);
  const [bulkActions, setBulkActions] = useState<RuleAction[]>([{ action: 'setAttribute', field: '', value: '' }]);
  const [bulkPreview, setBulkPreview] = useState<{ count: number; ids: string[] } | null>(null);

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
      useAppStore.getState().markClean();
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

  // ── Bulk Edit ──────────────────────────────────────────────────────────

  const handleBulkPreview = useCallback(async () => {
    const doc = useAppStore.getState().document;
    if (!doc) return;
    try {
      const result = await invoke<{ affectedNodeIds: string[]; count: number }>('preview_rule', {
        documentId: doc.id,
        rule: { filters: bulkFilters, actions: bulkActions },
      });
      setBulkPreview({ count: result.count, ids: result.affectedNodeIds });
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }, [bulkFilters, bulkActions]);

  const handleBulkApply = useCallback(async () => {
    const doc = useAppStore.getState().document;
    if (!doc) return;
    try {
      await invoke<number>('apply_rule', {
        documentId: doc.id,
        rule: { filters: bulkFilters, actions: bulkActions },
      });
      // Reload nodes + attributes after bulk changes
      const newNodes = await invoke<any[]>('get_nodes', { documentId: doc.id });
      const newAttrs = await invoke<any[]>('get_attributes', { documentId: doc.id });
      useAppStore.getState().loadDocument(
        { ...doc, nodeCount: newNodes.length },
        newNodes,
        newAttrs,
      );
      setShowBulkEdit(false);
      setBulkPreview(null);
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }, [bulkFilters, bulkActions]);

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <span className="toolbar__logo">AstraXML</span>
        {document && (
          <span className="toolbar__file">
            {isDirty && <span className="toolbar__dirty" title="Unsaved changes">● </span>}
            {document.displayName}
          </span>
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
        <button
          className="toolbar__btn toolbar__btn--accent"
          onClick={() => setShowBulkEdit(true)}
          disabled={!document}
        >Bulk Edit</button>
        <button
          className={`toolbar__btn toolbar__log-btn${errorCount > 0 ? ' toolbar__log-btn--alert' : ''}`}
          onClick={toggleLog}
          title="Toggle error log"
        >
          {errorCount > 0 ? `⚠ ${errorCount}` : 'Log'}
        </button>
      </div>

      {/* ── Bulk Edit Modal ──────────────────────────────────────────── */}
      {showBulkEdit && (
        <div className="toolbar__modal-overlay" onClick={() => setShowBulkEdit(false)}>
          <div className="toolbar__modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="toolbar__modal-title">Bulk Edit Rules</h3>

            <div className="toolbar__modal-section">
              <h4>Filters (match nodes)</h4>
              {bulkFilters.map((f, i) => (
                <div key={i} className="toolbar__rule-row">
                  <input
                    className="toolbar__rule-input"
                    placeholder="field (e.g. name, @attr)"
                    value={f.field}
                    onChange={(e) => {
                      const next = [...bulkFilters];
                      next[i] = { ...f, field: e.target.value };
                      setBulkFilters(next);
                    }}
                  />
                  <select
                    className="toolbar__rule-select"
                    value={f.op}
                    onChange={(e) => {
                      const next = [...bulkFilters];
                      next[i] = { ...f, op: e.target.value as RuleFilter['op'] };
                      setBulkFilters(next);
                    }}
                  >
                    <option value="contains">contains</option>
                    <option value="equals">equals</option>
                    <option value="notEquals">not equals</option>
                    <option value="greaterThan">&gt;</option>
                    <option value="lessThan">&lt;</option>
                  </select>
                  <input
                    className="toolbar__rule-input"
                    placeholder="value"
                    value={f.value}
                    onChange={(e) => {
                      const next = [...bulkFilters];
                      next[i] = { ...f, value: e.target.value };
                      setBulkFilters(next);
                    }}
                  />
                  {bulkFilters.length > 1 && (
                    <button className="toolbar__rule-remove" onClick={() => setBulkFilters(bulkFilters.filter((_, j) => j !== i))}>×</button>
                  )}
                </div>
              ))}
              <button className="toolbar__rule-add" onClick={() => setBulkFilters([...bulkFilters, { field: '', op: 'contains', value: '' }])}>+ Add Filter</button>
            </div>

            <div className="toolbar__modal-section">
              <h4>Actions (apply to matched nodes)</h4>
              {bulkActions.map((a, i) => (
                <div key={i} className="toolbar__rule-row">
                  <select
                    className="toolbar__rule-select"
                    value={a.action}
                    onChange={(e) => {
                      const next = [...bulkActions];
                      next[i] = { ...a, action: e.target.value as RuleAction['action'] };
                      setBulkActions(next);
                    }}
                  >
                    <option value="setAttribute">Set Attribute</option>
                    <option value="setValue">Set Value</option>
                    <option value="addTag">Add Tag</option>
                    <option value="removeTag">Remove Tag</option>
                    <option value="deleteNode">Delete Node</option>
                  </select>
                  <input
                    className="toolbar__rule-input"
                    placeholder="field"
                    value={a.field}
                    onChange={(e) => {
                      const next = [...bulkActions];
                      next[i] = { ...a, field: e.target.value };
                      setBulkActions(next);
                    }}
                  />
                  <input
                    className="toolbar__rule-input"
                    placeholder="value"
                    value={a.value}
                    onChange={(e) => {
                      const next = [...bulkActions];
                      next[i] = { ...a, value: e.target.value };
                      setBulkActions(next);
                    }}
                  />
                  {bulkActions.length > 1 && (
                    <button className="toolbar__rule-remove" onClick={() => setBulkActions(bulkActions.filter((_, j) => j !== i))}>×</button>
                  )}
                </div>
              ))}
              <button className="toolbar__rule-add" onClick={() => setBulkActions([...bulkActions, { action: 'setAttribute', field: '', value: '' }])}>+ Add Action</button>
            </div>

            {bulkPreview && (
              <div className="toolbar__modal-preview">
                <strong>{bulkPreview.count}</strong> nodes will be affected
              </div>
            )}

            <div className="toolbar__modal-actions">
              <button className="toolbar__btn" onClick={handleBulkPreview}>Preview</button>
              <button className="toolbar__btn toolbar__btn--accent" onClick={handleBulkApply} disabled={!bulkPreview || bulkPreview.count === 0}>Apply</button>
              <button className="toolbar__btn" onClick={() => { setShowBulkEdit(false); setBulkPreview(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
