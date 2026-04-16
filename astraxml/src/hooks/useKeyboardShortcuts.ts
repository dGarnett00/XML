import { useEffect } from 'react';
import { useAppStore, XmlNode } from '../store/app';
import { invoke } from '../lib/tauri';

/**
 * Global keyboard shortcuts for the editor.
 * - Ctrl+S: Save document
 * - Ctrl+D: Clone selected node
 * - F2: Edit selected node (select in detail panel)
 * - Ctrl+C: Copy selected node IDs to clipboard
 * - Ctrl+V: Paste (clone) copied nodes
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    async function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // ── Ctrl+S: Save ──────────────────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const doc = useAppStore.getState().document;
        if (!doc) return;
        try {
          await invoke('export_document', { documentId: doc.id, destPath: doc.path });
          useAppStore.getState().markClean();
        } catch (err) {
          useAppStore.getState().setError(String(err));
        }
        return;
      }

      // Skip other shortcuts when typing in inputs
      if (isInput) return;

      const store = useAppStore.getState();

      // ── Ctrl+D: Clone selected ────────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        if (!store.selectedNodeId) return;
        try {
          const newNodes = await invoke<XmlNode[]>('clone_node', { nodeId: store.selectedNodeId });
          store.addNodes(newNodes);
        } catch (err) {
          store.setError(String(err));
        }
        return;
      }

      // ── Ctrl+C: Copy to clipboard ────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        const ids = store.multiSelectedIds.size > 0
          ? Array.from(store.multiSelectedIds)
          : store.selectedNodeId ? [store.selectedNodeId] : [];
        if (ids.length > 0) store.setClipboard(ids);
        return;
      }

      // ── Ctrl+V: Paste (clone from clipboard) ──────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        if (store.clipboardNodeIds.length === 0) return;
        for (const id of store.clipboardNodeIds) {
          try {
            // Check if node still exists
            if (!store.nodes.find((n) => n.id === id)) continue;
            const newNodes = await invoke<XmlNode[]>('clone_node', { nodeId: id });
            useAppStore.getState().addNodes(newNodes);
          } catch (err) {
            useAppStore.getState().setError(String(err));
            break;
          }
        }
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
