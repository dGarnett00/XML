import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, XmlNode, XmlAttribute } from '../store/app';
import { invoke } from '../lib/tauri';
import { ContextMenu, ContextMenuItem } from '../panels/ContextMenu';
import './TableView.css';

// ── Types ──────────────────────────────────────────────────────────────────

interface GroupRow {
  node: XmlNode;
  nameAttr: string;
  attrs: XmlAttribute[];
  children: ChildRow[];
  textValue: string;
  childValueMap: Map<string, string>; // child element name → text value
}

interface ChildRow {
  node: XmlNode;
  attrs: XmlAttribute[];
  textValue: string;
}

type SortKey = 'index' | 'element' | 'name' | 'children' | string; // string for dynamic child-value columns
type SortDir = 'asc' | 'desc';

// ── Editable Cell ──────────────────────────────────────────────────────────

const EditableCell = memo(function EditableCell({ value, onCommit, className, highlight }: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  highlight?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(value);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setEditing(false);
  }

  if (editing) {
    return (
      <input
        className="tv__cell-edit"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKey}
        autoFocus
        title="Edit value"
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  const display = value || '\u00A0';
  if (highlight && value && value.toLowerCase().includes(highlight.toLowerCase())) {
    const idx = value.toLowerCase().indexOf(highlight.toLowerCase());
    return (
      <span className={className} onDoubleClick={startEdit}>
        {value.slice(0, idx)}
        <mark className="tv__highlight">{value.slice(idx, idx + highlight.length)}</mark>
        {value.slice(idx + highlight.length)}
      </span>
    );
  }
  return <span className={className} onDoubleClick={startEdit}>{display}</span>;
}
);

// ── Safe regex helper ──────────────────────────────────────────────────

function safeRegex(pattern: string, flags?: string): RegExp | null {
  try { return new RegExp(pattern, flags); }
  catch { return null; }
}

// ── Group Row ──────────────────────────────────────────────────────────────

const GroupRowView = memo(function GroupRowView({ group, index, isSelected, isMultiSelected, isExpanded, onToggle, onSelect, onContextMenu, childColumns, highlight }: {
  group: GroupRow;
  index: number;
  isSelected: boolean;
  isMultiSelected: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  childColumns: string[];
  highlight: string;
}) {
  const updateNodeLocal = useAppStore((s) => s.updateNodeLocal);
  const updateAttributeLocal = useAppStore((s) => s.updateAttributeLocal);
  const otherAttrs = group.attrs.filter((a) => a.name !== 'name');
  const nameAttrObj = group.attrs.find((a) => a.name === 'name');

  async function handleNameEdit(newName: string) {
    try {
      await invoke('update_node', { nodeId: group.node.id, name: newName, value: null });
      updateNodeLocal(group.node.id, { name: newName });
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }

  async function handleNameAttrEdit(newValue: string) {
    if (!nameAttrObj) return;
    try {
      await invoke('set_attribute', { nodeId: group.node.id, attrName: 'name', attrValue: newValue });
      updateAttributeLocal(nameAttrObj.id, { value: newValue });
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }

  return (
    <tr
      className={`tv__row tv__row--group${isSelected ? ' selected' : ''}${isMultiSelected ? ' multi-selected' : ''}${isExpanded ? ' expanded' : ''}`}
      onClick={(e) => onSelect(group.node.id, e)}
      onContextMenu={(e) => onContextMenu(e, group.node.id)}
      data-node-id={group.node.id}
    >
      <td className="tv__cell tv__cell--index">{index + 1}</td>
      <td className="tv__cell tv__cell--expand">
        <button className="tv__expand-btn" onClick={(e) => { e.stopPropagation(); onToggle(); }} title={isExpanded ? 'Collapse' : 'Expand'}>
          {isExpanded ? '▾' : '▸'}
        </button>
      </td>
      <td className="tv__cell tv__cell--element">
        <EditableCell value={group.node.name} onCommit={handleNameEdit} className="tv__el-name" highlight={highlight} />
      </td>
      <td className="tv__cell tv__cell--name">
        {group.nameAttr ? (
          <EditableCell value={group.nameAttr} onCommit={handleNameAttrEdit} className="tv__name-val" highlight={highlight} />
        ) : (
          <span className="tv__name-none">—</span>
        )}
      </td>
      {childColumns.map((col) => {
        const colVal = group.childValueMap.get(col) ?? '';
        return (
          <td key={col} className="tv__cell tv__cell--child-col">
            <EditableCell
              value={colVal}
              onCommit={async (newVal: string) => {
                try {
                  await invoke('set_child_value', { parentId: group.node.id, childName: col, childValue: newVal });
                  // Update local text child node
                  const store = useAppStore.getState();
                  const childNode = store.nodes.find((n) => n.parentId === group.node.id && n.name === col && n.nodeType === 'element');
                  if (childNode) {
                    const textChild = store.nodes.find((n) => n.parentId === childNode.id && n.nodeType === 'text');
                    if (textChild) store.updateNodeLocal(textChild.id, { value: newVal });
                  }
                } catch (e) {
                  useAppStore.getState().setError(String(e));
                }
              }}
              className="tv__child-col-val"
              highlight={highlight}
            />
          </td>
        );
      })}
      <td className="tv__cell tv__cell--children-count">
        <span className="tv__count-badge">{group.children.length}</span>
      </td>
      <td className="tv__cell tv__cell--attrs">
        {otherAttrs.map((a) => (
          <span key={a.id} className="tv__attr-badge" title={`${a.name}="${a.value}"`}>
            {a.name}=<span className="tv__attr-badge-val">{a.value}</span>
          </span>
        ))}
      </td>
    </tr>
  );
}
);

// ── Child Row ──────────────────────────────────────────────────────────────

const ChildRowView = memo(function ChildRowView({ child, isSelected, onSelect, childColumns, highlight }: {
  child: ChildRow;
  isSelected: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
  childColumns: string[];
  highlight: string;
}) {
  const nodes = useAppStore((s) => s.nodes);
  const updateNodeLocal = useAppStore((s) => s.updateNodeLocal);

  async function handleValueEdit(newValue: string) {
    try {
      const parentNode = child.node;
      if (!parentNode.parentId) return;
      await invoke('set_child_value', { parentId: parentNode.parentId, childName: parentNode.name, childValue: newValue });
      const textChild = nodes.find((n) => n.parentId === parentNode.id && n.nodeType === 'text');
      if (textChild) updateNodeLocal(textChild.id, { value: newValue });
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }

  // colSpan accounts for child-value columns + children count
  const extraCols = childColumns.length + 1;

  return (
    <tr
      className={`tv__row tv__row--child${isSelected ? ' selected' : ''}`}
      onClick={(e) => onSelect(child.node.id, e)}
      data-node-id={child.node.id}
    >
      <td className="tv__cell tv__cell--index" />
      <td className="tv__cell tv__cell--expand" />
      <td className="tv__cell tv__cell--child-name">
        <span className="tv__child-tag">{child.node.name}</span>
      </td>
      <td className="tv__cell tv__cell--child-value" colSpan={1 + extraCols}>
        <EditableCell value={child.textValue} onCommit={handleValueEdit} className="tv__child-text" highlight={highlight} />
      </td>
      <td className="tv__cell tv__cell--child-attrs">
        {child.attrs.map((a) => (
          <span key={a.id} className="tv__attr-badge" title={`${a.name}="${a.value}"`}>
            {a.name}=<span className="tv__attr-badge-val">{a.value}</span>
          </span>
        ))}
      </td>
    </tr>
  );
}
);

// ── Sort Header ────────────────────────────────────────────────────────────

function SortHeader({ label, sortKey, currentSort, onSort, className }: {
  label: string;
  sortKey: SortKey;
  currentSort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = currentSort.key === sortKey;
  return (
    <th className={`tv__th tv__th--sortable${active ? ' active' : ''} ${className ?? ''}`} onClick={() => onSort(sortKey)}>
      {label}
      {active && <span className="tv__sort-arrow">{currentSort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
    </th>
  );
}

// ── Main Table ─────────────────────────────────────────────────────────────

export function TableView() {
  const nodes = useAppStore((s) => s.nodes);
  const attributes = useAppStore((s) => s.attributes);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const selectNode = useAppStore((s) => s.selectNode);
  const document = useAppStore((s) => s.document);
  const filter = useAppStore((s) => s.filter);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
  const [focusIndex, setFocusIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Data lookups ─────────────────────────────────────────────────────────

  const attrsByNode = useMemo(() => {
    const map = new Map<string, XmlAttribute[]>();
    for (const attr of attributes) {
      const list = map.get(attr.nodeId);
      if (list) list.push(attr);
      else map.set(attr.nodeId, [attr]);
    }
    return map;
  }, [attributes]);

  const textValueByParent = useMemo(() => {
    const map = new Map<string, string>();
    const textByParent = new Map<string, string[]>();
    const elementChildCounts = new Map<string, number>();
    for (const n of nodes) {
      if (!n.parentId) continue;
      if (n.nodeType === 'text' && n.value) {
        const list = textByParent.get(n.parentId);
        if (list) list.push(n.value);
        else textByParent.set(n.parentId, [n.value]);
      }
      if (n.nodeType === 'element') {
        elementChildCounts.set(n.parentId, (elementChildCounts.get(n.parentId) ?? 0) + 1);
      }
    }
    for (const [parentId, texts] of textByParent) {
      if (!elementChildCounts.has(parentId)) {
        map.set(parentId, texts.join(''));
      }
    }
    return map;
  }, [nodes]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, XmlNode[]>();
    for (const n of nodes) {
      if (!n.parentId || n.nodeType !== 'element') continue;
      const list = map.get(n.parentId);
      if (list) list.push(n);
      else map.set(n.parentId, [n]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.orderIndex - b.orderIndex);
    }
    return map;
  }, [nodes]);

  const rootNode = useMemo(() => nodes.find((n) => n.parentId === null && n.nodeType === 'element'), [nodes]);

  // ── Build group rows ────────────────────────────────────────────────────

  const groups: GroupRow[] = useMemo(() => {
    if (!rootNode) return [];
    const topLevelElements = childrenByParent.get(rootNode.id) ?? [];

    return topLevelElements.map((node) => {
      const attrs = attrsByNode.get(node.id) ?? [];
      const nameAttrObj = attrs.find((a) => a.name === 'name');
      const kids = childrenByParent.get(node.id) ?? [];
      const childRows: ChildRow[] = kids.map((kid) => ({
        node: kid,
        attrs: attrsByNode.get(kid.id) ?? [],
        textValue: textValueByParent.get(kid.id) ?? '',
      }));
      const childValueMap = new Map<string, string>();
      for (const cr of childRows) {
        if (cr.textValue) childValueMap.set(cr.node.name, cr.textValue);
      }
      return {
        node,
        nameAttr: nameAttrObj?.value ?? '',
        attrs,
        children: childRows,
        textValue: textValueByParent.get(node.id) ?? '',
        childValueMap,
      };
    });
  }, [rootNode, childrenByParent, attrsByNode, textValueByParent]);

  // ── Auto-detect common child element columns ───────────────────────────

  const childColumns = useMemo(() => {
    if (groups.length === 0) return [];
    // Count how often each child element name appears with a text value
    const freq = new Map<string, number>();
    for (const g of groups) {
      for (const [name] of g.childValueMap) {
        freq.set(name, (freq.get(name) ?? 0) + 1);
      }
    }
    // Show columns that appear in at least 30% of groups (min 2) and have short values
    const threshold = Math.max(2, Math.floor(groups.length * 0.3));
    const cols: string[] = [];
    for (const [name, count] of freq) {
      if (count >= threshold) cols.push(name);
    }
    // Sort by frequency descending, cap at 6 columns
    cols.sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0));
    return cols.slice(0, 6);
  }, [groups]);

  // ── Filter ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return groups.filter((g) => {
      if (filter.tag) {
        const match = filter.mode === 'equals'
          ? g.node.name === filter.tag
          : filter.mode === 'regex'
            ? (safeRegex(filter.tag, 'i')?.test(g.node.name) ?? false)
            : g.node.name.toLowerCase().includes(filter.tag.toLowerCase());
        if (!match) return false;
      }
      if (filter.attribute) {
        const term = filter.attribute.toLowerCase();
        const hasMatch = g.attrs.some((a) => {
          const combined = `${a.name}=${a.value}`.toLowerCase();
          return filter.mode === 'equals'
            ? a.value === filter.attribute || a.name === filter.attribute
            : filter.mode === 'regex'
              ? (safeRegex(filter.attribute, 'i')?.test(combined) ?? false)
              : combined.includes(term);
        }) || g.nameAttr.toLowerCase().includes(term);
        if (!hasMatch) return false;
      }
      if (filter.value) {
        const allText = [g.textValue, ...g.children.map((c) => c.textValue)].join(' ').toLowerCase();
        const match = filter.mode === 'equals'
          ? g.children.some((c) => c.textValue === filter.value) || g.textValue === filter.value
          : filter.mode === 'regex'
            ? (safeRegex(filter.value, 'i')?.test(allText) ?? false)
            : allText.includes(filter.value.toLowerCase());
        if (!match) return false;
      }
      return true;
    });
  }, [groups, filter]);

  // ── Sort ────────────────────────────────────────────────────────────────

  const sorted = useMemo(() => {
    const list = [...filtered];
    const dir = sort.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      switch (sort.key) {
        case 'index': return 0; // natural order
        case 'element': return dir * a.node.name.localeCompare(b.node.name);
        case 'name': return dir * a.nameAttr.localeCompare(b.nameAttr);
        case 'children': return dir * (a.children.length - b.children.length);
        default: {
          // Dynamic child-value column sort
          const aVal = a.childValueMap.get(sort.key) ?? '';
          const bVal = b.childValueMap.get(sort.key) ?? '';
          // Try numeric sort first
          const aNum = Number(aVal);
          const bNum = Number(bVal);
          if (!isNaN(aNum) && !isNaN(bNum)) return dir * (aNum - bNum);
          return dir * aVal.localeCompare(bVal);
        }
      }
    });
    return list;
  }, [filtered, sort]);

  // ── Highlight term ──────────────────────────────────────────────────────

  const highlight = filter.attribute || filter.value || '';

  // ── Selection handlers ──────────────────────────────────────────────────

  const handleSelect = useCallback((id: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Toggle multi-select
      setMultiSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else if (e.shiftKey && selectedNodeId) {
      // Range select
      const allIds = sorted.map((g) => g.node.id);
      const startIdx = allIds.indexOf(selectedNodeId);
      const endIdx = allIds.indexOf(id);
      if (startIdx >= 0 && endIdx >= 0) {
        const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        setMultiSelectedIds(new Set(allIds.slice(lo, hi + 1)));
      }
    } else {
      setMultiSelectedIds(new Set());
      selectNode(id);
    }
    // Update focus index
    const idx = sorted.findIndex((g) => g.node.id === id);
    if (idx >= 0) setFocusIndex(idx);
  }, [sorted, selectedNodeId, selectNode]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSort = useCallback((key: SortKey) => {
    setSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  const expandAll = useCallback(() => setExpandedIds(new Set(sorted.map((g) => g.node.id))), [sorted]);
  const collapseAll = useCallback(() => setExpandedIds(new Set()), []);

  // ── Keyboard navigation ─────────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!sorted.length) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = Math.min(focusIndex + 1, sorted.length - 1);
          setFocusIndex(next);
          selectNode(sorted[next].node.id);
          scrollToRow(sorted[next].node.id);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = Math.max(focusIndex - 1, 0);
          setFocusIndex(prev);
          selectNode(sorted[prev].node.id);
          scrollToRow(sorted[prev].node.id);
          break;
        }
        case ' ': {
          e.preventDefault();
          if (focusIndex >= 0 && focusIndex < sorted.length) {
            toggleExpand(sorted[focusIndex].node.id);
          }
          break;
        }
        case 'ArrowRight': {
          if (focusIndex >= 0 && focusIndex < sorted.length) {
            const id = sorted[focusIndex].node.id;
            if (!expandedIds.has(id)) { e.preventDefault(); toggleExpand(id); }
          }
          break;
        }
        case 'ArrowLeft': {
          if (focusIndex >= 0 && focusIndex < sorted.length) {
            const id = sorted[focusIndex].node.id;
            if (expandedIds.has(id)) { e.preventDefault(); toggleExpand(id); }
          }
          break;
        }
        case 'Delete': {
          e.preventDefault();
          handleBatchDelete();
          break;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusIndex, sorted, expandedIds, toggleExpand, selectNode]);

  function scrollToRow(nodeId: string) {
    const el = scrollRef.current?.querySelector(`[data-node-id="${nodeId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ── Batch operations ────────────────────────────────────────────────────

  const batchIds = multiSelectedIds.size > 0 ? multiSelectedIds : (selectedNodeId ? new Set([selectedNodeId]) : new Set<string>());

  async function handleBatchDelete() {
    if (batchIds.size === 0) return;
    const removeNodes = useAppStore.getState().removeNodes;
    for (const id of batchIds) {
      try {
        const deletedIds = await invoke<string[]>('delete_node', { nodeId: id });
        removeNodes(deletedIds);
      } catch (e) {
        useAppStore.getState().setError(String(e));
        break;
      }
    }
    setMultiSelectedIds(new Set());
  }

  async function handleBatchClone() {
    if (batchIds.size === 0) return;
    const addNodes = useAppStore.getState().addNodes;
    for (const id of batchIds) {
      try {
        const newNodes = await invoke<XmlNode[]>('clone_node', { nodeId: id });
        addNodes(newNodes);
      } catch (e) {
        useAppStore.getState().setError(String(e));
        break;
      }
    }
  }

  // ── Context Menu ────────────────────────────────────────────────────────

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);

  const handleRowContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    selectNode(nodeId);
    setCtxMenu({ x: e.clientX, y: e.clientY, nodeId });
  }, [selectNode]);

  const ctxMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!ctxMenu) return [];
    return [
      { label: 'Clone', icon: '📋', shortcut: 'Ctrl+D', onClick: () => handleBatchClone() },
      { label: 'separator', separator: true, onClick: () => {} },
      { label: 'Delete', icon: '🗑', shortcut: 'Del', danger: true, onClick: () => handleBatchDelete() },
    ];
  }, [ctxMenu]);

  // ── Render ──────────────────────────────────────────────────────────────

  if (!document) {
    return (
      <div className="table-view table-view--empty">
        <div className="tv__empty-icon">📄</div>
        <p className="tv__empty-title">No document open</p>
        <p className="tv__hint">File → Open or drag & drop an XML file</p>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="table-view table-view--empty">
        <div className="tv__empty-icon">📋</div>
        <p className="tv__empty-title">No items found</p>
        <p className="tv__hint">The document has no child elements to display</p>
      </div>
    );
  }

  return (
    <div className="table-view" tabIndex={0}>
      {/* ── Toolbar ──────────────────────────────────────────────── */}
      <div className="tv__toolbar">
        <div className="tv__toolbar-left">
          <span className="tv__toolbar-info">
            {sorted.length === groups.length
              ? <><strong>{groups.length}</strong> items</>
              : <><strong>{sorted.length}</strong> of {groups.length} items</>
            }
            {rootNode && <span className="tv__toolbar-root"> in &lt;{rootNode.name}&gt;</span>}
          </span>
          {multiSelectedIds.size > 0 && (
            <span className="tv__toolbar-selection">{multiSelectedIds.size} selected</span>
          )}
        </div>
        <div className="tv__toolbar-actions">
          {batchIds.size > 0 && (
            <>
              <button className="tv__toolbar-btn tv__toolbar-btn--clone" onClick={handleBatchClone} title="Clone selected">
                ⧉ Clone
              </button>
              <button className="tv__toolbar-btn tv__toolbar-btn--danger" onClick={handleBatchDelete} title="Delete selected">
                ✕ Delete
              </button>
              <span className="tv__toolbar-sep" />
            </>
          )}
          <button className="tv__toolbar-btn" onClick={expandAll} title="Expand all">⊞ Expand</button>
          <button className="tv__toolbar-btn" onClick={collapseAll} title="Collapse all">⊟ Collapse</button>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────── */}
      <div className="tv__scroll" ref={scrollRef}>
        <table className="tv__table">
          <thead>
            <tr>
              <th className="tv__th tv__th--index">#</th>
              <th className="tv__th tv__th--expand" />
              <SortHeader label="Element" sortKey="element" currentSort={sort} onSort={handleSort} />
              <SortHeader label="Name" sortKey="name" currentSort={sort} onSort={handleSort} />
              {childColumns.map((col) => (
                <SortHeader key={col} label={col} sortKey={col} currentSort={sort} onSort={handleSort} className="tv__th--child-col" />
              ))}
              <SortHeader label="Children" sortKey="children" currentSort={sort} onSort={handleSort} className="tv__th--count" />
              <th className="tv__th">Attributes</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((group, i) => {
              const isExpanded = expandedIds.has(group.node.id);
              return [
                <GroupRowView
                  key={group.node.id}
                  group={group}
                  index={i}
                  isSelected={group.node.id === selectedNodeId}
                  isMultiSelected={multiSelectedIds.has(group.node.id)}
                  isExpanded={isExpanded}
                  onToggle={() => toggleExpand(group.node.id)}
                  onSelect={handleSelect}
                  onContextMenu={handleRowContextMenu}
                  childColumns={childColumns}
                  highlight={highlight}
                />,
                ...(isExpanded
                  ? group.children.map((child) => (
                      <ChildRowView
                        key={child.node.id}
                        child={child}
                        isSelected={child.node.id === selectedNodeId}
                        onSelect={handleSelect}
                        childColumns={childColumns}
                        highlight={highlight}
                      />
                    ))
                  : []),
              ];
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <div className="tv__footer">
        <span className="tv__footer-text">
          ↑↓ navigate &nbsp; Space expand &nbsp; ←→ collapse/expand &nbsp; Ctrl+Click multi-select &nbsp; Shift+Click range
        </span>
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenuItems}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
