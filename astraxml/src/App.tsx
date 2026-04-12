import { Toolbar } from './panels/Toolbar';
import { StatusBar } from './panels/StatusBar';
import { DetailPanel } from './panels/DetailPanel';
import { TableView } from './views/TableView';
import { TreeView } from './views/TreeView';
import { RawView } from './views/RawView';
import { useAppStore } from './store/app';
import './App.css';

export default function App() {
  const { viewMode } = useAppStore();

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

      <StatusBar />
    </div>
  );
}

