import { Toolbar } from './panels/Toolbar';
import { StatusBar } from './panels/StatusBar';
import { DetailPanel } from './panels/DetailPanel';
import { ErrorLogPanel } from './panels/ErrorLogPanel';
import { TableView } from './views/TableView';
import { TreeView } from './views/TreeView';
import { RawView } from './views/RawView';
import { useAppStore } from './store/app';
import { useErrorLog } from './hooks/useErrorLog';
import './App.css';

export default function App() {
  const { viewMode } = useAppStore();
  useErrorLog();

  return (
    <div className="app">
      <Toolbar />

      <div className="app__body">
        <div className="app__main">
          {viewMode === 'table' && <TableView />}
          {viewMode === 'tree'  && <TreeView />}
          {viewMode === 'raw'   && <RawView />}
        </div>
        <DetailPanel />
      </div>

      <ErrorLogPanel />
      <StatusBar />
    </div>
  );
}

