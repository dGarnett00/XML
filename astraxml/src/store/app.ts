import { create } from 'zustand';

export interface XmlNode {
  id: string;
  documentId: string;
  parentId: string | null;
  nodeType: 'element' | 'attribute' | 'text' | 'comment';
  name: string;
  value: string | null;
  orderIndex: number;
  depth: number;
}

export interface DocumentInfo {
  id: string;
  path: string;
  displayName: string;
  rootNodeId: string | null;
  nodeCount: number;
}

export type ViewMode = 'table' | 'tree' | 'raw';

interface AppState {
  document: DocumentInfo | null;
  nodes: XmlNode[];
  selectedNodeId: string | null;
  viewMode: ViewMode;
  searchQuery: string;
  isLoading: boolean;
  error: string | null;

  setDocument: (doc: DocumentInfo) => void;
  setNodes: (nodes: XmlNode[]) => void;
  selectNode: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setSearchQuery: (q: string) => void;
  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  document: null,
  nodes: [],
  selectedNodeId: null,
  viewMode: 'table',
  searchQuery: '',
  isLoading: false,
  error: null,

  setDocument: (doc) => set({ document: doc }),
  setNodes: (nodes) => set({ nodes }),
  selectNode: (id) => set({ selectedNodeId: id }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setLoading: (v) => set({ isLoading: v }),
  setError: (msg) => set({ error: msg }),
  reset: () => set({ document: null, nodes: [], selectedNodeId: null }),
}));
