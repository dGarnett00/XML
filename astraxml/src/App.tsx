import { useCallback, lazy, Suspense } from 'react';
import { Toolbar } from './panels/Toolbar';
import { FilterBar } from './panels/FilterBar';
import { StatusBar } from './panels/StatusBar';
import { DetailPanel } from './panels/DetailPanel';
import { ErrorLogPanel } from './panels/ErrorLogPanel';
const TableView = lazy(() => import('./views/TableView').then((m) => ({ default: m.TableView })));
const TreeView = lazy(() => import('./views/TreeView').then((m) => ({ default: m.TreeView })));
const RawView = lazy(() => import('./views/RawView').then((m) => ({ default: m.RawView })));
import { useAppStore, OpenDocumentResult } from './store/app';
import { useErrorLog } from './hooks/useErrorLog';
import { invoke } from './lib/tauri';
import './App.css';

export default function App() {
  const viewMode = useAppStore((s) => s.viewMode);
  useErrorLog();

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const xmlFile = files.find((f) => f.name.endsWith('.xml'));
    if (!xmlFile) return;

    const store = useAppStore.getState();
    store.setLoading(true);
    store.setError(null);
    try {
      // In Tauri, dataTransfer.files gives us file paths via the `path` property
      const path = (xmlFile as any).path ?? xmlFile.name;
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
    } catch (err) {
      store.setError(String(err));
    } finally {
      store.setLoading(false);
    }
  }, []);

  return (
    <div className="app" onDragOver={handleDragOver} onDrop={handleDrop}>
      <Toolbar />
      <FilterBar />

      <div className="app__body">
        <div className="app__main">
          <Suspense fallback={<div className="app__loading">Loading view…</div>}>
            {viewMode === 'table' && <TableView />}
            {viewMode === 'tree'  && <TreeView />}
            {viewMode === 'raw'   && <RawView />}
          </Suspense>
        </div>
        <DetailPanel />
      </div>

      <ErrorLogPanel />
      <StatusBar />
    </div>
  );
}

