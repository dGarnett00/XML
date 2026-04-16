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

export interface XmlAttribute {
  id: string;
  nodeId: string;
  name: string;
  value: string;
}

export interface DocumentInfo {
  id: string;
  path: string;
  displayName: string;
  rootNodeId: string | null;
  nodeCount: number;
}

export type ViewMode = 'table' | 'tree' | 'raw';

export interface OpenDocumentResult {
  document: {
    id: string;
    path: string;
    displayName: string;
    rootNodeId: string | null;
  };
  nodeCount: number;
  nodes: XmlNode[];
  attributes: XmlAttribute[];
}

export interface FilterCriteria {
  tag: string;
  attribute: string;
  value: string;
  mode: 'contains' | 'equals' | 'regex';
}

interface AppState {
  document: DocumentInfo | null;
  nodes: XmlNode[];
  attributes: XmlAttribute[];
  selectedNodeId: string | null;
  viewMode: ViewMode;
  searchQuery: string;
  isLoading: boolean;
  error: string | null;
  filter: FilterCriteria;

  loadDocument: (doc: DocumentInfo, nodes: XmlNode[], attributes: XmlAttribute[]) => void;
  selectNode: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setSearchQuery: (q: string) => void;
  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
  setFilter: (f: Partial<FilterCriteria>) => void;
  resetFilter: () => void;
  reset: () => void;

  // CRUD helpers (mutate local state after successful backend calls)
  addNodes: (nodes: XmlNode[]) => void;
  removeNodes: (ids: string[]) => void;
  updateNodeLocal: (id: string, patch: Partial<XmlNode>) => void;
}

const EMPTY_FILTER: FilterCriteria = { tag: '', attribute: '', value: '', mode: 'contains' };

export const useAppStore = create<AppState>((set) => ({
  document: null,
  nodes: [],
  attributes: [],
  selectedNodeId: null,
  viewMode: 'table',
  searchQuery: '',
  isLoading: false,
  error: null,
  filter: { ...EMPTY_FILTER },

  loadDocument: (doc, nodes, attributes) => set({ document: doc, nodes, attributes, selectedNodeId: null }),
  selectNode: (id) => set({ selectedNodeId: id }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setLoading: (v) => set({ isLoading: v }),
  setError: (msg) => set({ error: msg }),
  setFilter: (f) => set((s) => ({ filter: { ...s.filter, ...f } })),
  resetFilter: () => set({ filter: { ...EMPTY_FILTER } }),
  reset: () => set({ document: null, nodes: [], attributes: [], selectedNodeId: null, filter: { ...EMPTY_FILTER } }),

  addNodes: (newNodes) => set((s) => ({ nodes: [...s.nodes, ...newNodes] })),
  removeNodes: (ids) => set((s) => {
    const idSet = new Set(ids);
    return {
      nodes: s.nodes.filter((n) => !idSet.has(n.id)),
      selectedNodeId: s.selectedNodeId && idSet.has(s.selectedNodeId) ? null : s.selectedNodeId,
    };
  }),
  updateNodeLocal: (id, patch) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
  })),
}));
